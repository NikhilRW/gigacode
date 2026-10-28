import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export interface StorageConfig {
  endpoint?: string;
  /** Endpoint used when presigning URLs for browsers (MinIO in dev is not reachable at its compose hostname). */
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
}

export type ErrorHook = (op: string, err: unknown) => void;

/** Thin S3 wrapper. Every call is a single attempt; callers decide retry policy. */
export class Storage {
  private readonly client: S3Client;
  private readonly presignClient: S3Client;
  readonly bucket: string;

  constructor(
    config: StorageConfig,
    private readonly onError: ErrorHook = () => {},
  ) {
    const base: S3ClientConfig = {
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      maxAttempts: 1,
      // Without these the SDK waits on a stalled socket indefinitely, which can wedge callers like the reaper.
      requestHandler: { connectionTimeout: 3000, requestTimeout: 15_000 },
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
          : undefined,
    };
    this.client = new S3Client({ ...base, endpoint: config.endpoint || undefined });
    this.presignClient = new S3Client({ ...base, endpoint: config.publicEndpoint || config.endpoint || undefined });
    this.bucket = config.bucket;
  }

  private async track<T>(op: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.onError(op, err);
      throw err;
    }
  }

  put(key: string, body: string | Uint8Array, contentType = 'application/octet-stream'): Promise<void> {
    return this.track('put', async () => {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
      );
    });
  }

  getBuffer(key: string, maxBytes?: number): Promise<Buffer> {
    return this.track('get', async () => {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: maxBytes !== undefined ? `bytes=0-${maxBytes - 1}` : undefined,
        }),
      );
      const bytes = await res.Body!.transformToByteArray();
      return Buffer.from(bytes);
    });
  }

  async getText(key: string, maxBytes?: number): Promise<string> {
    return (await this.getBuffer(key, maxBytes)).toString('utf8');
  }

  async getJson<T>(key: string): Promise<T> {
    return JSON.parse(await this.getText(key)) as T;
  }

  downloadToFile(key: string, path: string): Promise<void> {
    return this.track('get', async () => {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      await pipeline(res.Body as Readable, createWriteStream(path, { mode: 0o600 }));
    });
  }

  exists(key: string): Promise<boolean> {
    return this.track('head', async () => {
      try {
        await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
        return true;
      } catch (err) {
        if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
        throw err;
      }
    });
  }

  presignGet(key: string, expiresInSeconds = 60): Promise<string> {
    return this.track('presign', () =>
      getSignedUrl(this.presignClient, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      }),
    );
  }

  /** Delete every object under a prefix. Returns number deleted. */
  deletePrefix(prefix: string): Promise<number> {
    return this.track('delete', async () => {
      let deleted = 0;
      let token: string | undefined;
      do {
        const list = await this.client.send(
          new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
        );
        const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
        if (keys.length > 0) {
          await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }));
          deleted += keys.length;
        }
        token = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (token);
      return deleted;
    });
  }

  ensureBucket(): Promise<void> {
    return this.track('bucket', async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      }
    });
  }

  ping(): Promise<void> {
    return this.track('head', async () => {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    });
  }

  /** Backstop retention: expire objects under tenants/ after N days. */
  setRetentionLifecycle(days: number): Promise<void> {
    return this.track('lifecycle', async () => {
      await this.client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: this.bucket,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: 'tenant-artifact-retention',
                Status: 'Enabled',
                Filter: { Prefix: 'tenants/' },
                Expiration: { Days: days + 1 },
              },
            ],
          },
        }),
      );
    });
  }
}
