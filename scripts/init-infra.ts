// One-shot infrastructure init: DB migrations, worker login role, S3 bucket + lifecycle backstop.
import { ensureWorkerLogin, migrateUp } from '@engine/db';
import { Storage } from '@engine/storage';
import { withRetry } from '@engine/shared';

const env = process.env;
const databaseUrl = env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

await withRetry(() => migrateUp(databaseUrl), 10, 500);
console.log('migrations applied');

if (env.WORKER_DB_PASSWORD) {
  await ensureWorkerLogin(databaseUrl, env.WORKER_DB_LOGIN ?? 'worker_login', env.WORKER_DB_PASSWORD);
  console.log('worker login ensured');
}

const storage = new Storage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION ?? 'us-east-1',
  bucket: env.S3_BUCKET ?? 'engine-artifacts',
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
});
await withRetry(() => storage.ensureBucket(), 20, 500);
await storage
  .setRetentionLifecycle(Number(env.RETENTION_DAYS ?? 30))
  .catch((err) => console.warn('lifecycle rule not applied:', (err as Error).message));
console.log('bucket ready');
