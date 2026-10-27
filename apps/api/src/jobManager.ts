import { randomUUID } from 'node:crypto';
import {
  HARD_LIMITS,
  createExecutionSchema,
  requestHash,
  resolveLimits,
  s3Keys,
  sha256Hex,
  withRetry,
  type SourceManifest,
} from '@engine/shared';
import { AuthRepo, ExecutionRepo, transitionExecution, withTx } from '@engine/db';
import type { AppContext } from './context.ts';
import type { AuthContext } from './auth/session.ts';
import { ApiError, unauthorized } from './errors.ts';
import { parseBody } from './routes/util.ts';

export interface SubmitResult {
  replay: boolean;
  id: string;
  status: string;
}

/** Write path (spec §8): authenticate → rate limit → validate → idempotency → insert → upload → queue. */
export async function submitExecution(
  ctx: AppContext,
  auth: AuthContext,
  rawBody: unknown,
  idempotencyKey: string | undefined,
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void },
): Promise<SubmitResult> {
  const tenant = await new AuthRepo(ctx.pool).findTenant(auth.tenantId);
  if (!tenant) throw unauthorized();

  const rate = await ctx.rateLimiter.take(tenant.id, tenant.max_exec_per_min);
  if (!rate.allowed) {
    ctx.metrics.rateLimited.inc();
    throw new ApiError(429, 'rate_limited', 'execution rate limit exceeded', {
      'Retry-After': String(rate.retryAfterSeconds),
    });
  }

  const body = parseBody(createExecutionSchema, rawBody);
  const sourceBytes = body.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0);
  if (sourceBytes > tenant.max_source_bytes)
    throw new ApiError(413, 'source_too_large', `source exceeds ${tenant.max_source_bytes} bytes`);

  const limits = resolveLimits(body.limits, { maxTimeoutMs: tenant.max_timeout_ms, maxMemoryMb: tenant.max_memory_mb });
  if (!limits.ok) throw new ApiError(400, 'limit_exceeded', `limits.${limits.field} exceeds maximum ${limits.max}`);

  if (idempotencyKey !== undefined && !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey))
    throw new ApiError(400, 'validation_error', 'invalid Idempotency-Key header');

  const hash = requestHash(body);
  const repo = new ExecutionRepo(ctx.pool, tenant.id);

  const replay = async (): Promise<SubmitResult | null> => {
    if (!idempotencyKey) return null;
    const existing = await repo.findByIdempotencyKey(idempotencyKey);
    if (!existing) return null;
    if (existing.request_hash !== hash)
      throw new ApiError(409, 'idempotency_conflict', 'Idempotency-Key reused with a different request');
    return { replay: true, id: existing.id, status: existing.status };
  };
  const previous = await replay();
  if (previous) return previous;

  if ((await repo.countQueued()) >= HARD_LIMITS.queuedPerTenant)
    throw new ApiError(429, 'queue_full', `tenant has ${HARD_LIMITS.queuedPerTenant} queued executions`, {
      'Retry-After': '5',
    });

  const id = randomUUID();
  try {
    await withTx(ctx.pool, (client) =>
      new ExecutionRepo(client, tenant.id).insertCreated({
        id,
        createdByUserId: auth.userId,
        apiKeyId: auth.apiKeyId,
        idempotencyKey: idempotencyKey ?? null,
        requestHash: hash,
        language: body.language,
        entryFile: body.entryFile,
        priority: body.priority ?? 0,
        limits: limits.limits,
        artifactPrefix: s3Keys.sourcePrefix(tenant.id, id),
      }),
    );
  } catch (err) {
    // Concurrent request with the same idempotency key won the insert.
    if ((err as { code?: string }).code === '23505') {
      const raced = await replay();
      if (raced) return raced;
    }
    throw err;
  }
  ctx.metrics.executionsCreated.inc();
  log.info({ tenantId: tenant.id, executionId: id, files: body.files.length, sourceBytes }, 'execution created');

  try {
    const manifest: SourceManifest = {
      files: body.files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content), sha256: sha256Hex(f.content) })),
      stdin: { bytes: Buffer.byteLength(body.stdin), sha256: sha256Hex(body.stdin) },
    };
    await Promise.all(
      body.files.map((f) =>
        withRetry(() => ctx.storage.put(s3Keys.sourceFile(tenant.id, id, f.path), f.content, 'text/plain')),
      ),
    );
    await withRetry(() => ctx.storage.put(s3Keys.stdin(tenant.id, id), body.stdin, 'text/plain'));
    // Manifest last: its presence means the upload completed (used by the reconciler).
    await withRetry(() =>
      ctx.storage.put(s3Keys.manifest(tenant.id, id), JSON.stringify(manifest), 'application/json'),
    );
  } catch (err) {
    log.warn({ tenantId: tenant.id, executionId: id, err: (err as Error).name }, 'artifact upload failed');
    await transitionExecution(
      ctx.pool,
      { id, tenantId: tenant.id, from: 'CREATED', to: 'FAILED', set: { failure_reason: 'artifact_upload_failed' } },
      ctx.events.afterCommit,
    ).catch(() => {});
    throw new ApiError(503, 'artifact_upload_failed', 'could not store source; try again');
  }

  await transitionExecution(
    ctx.pool,
    { id, tenantId: tenant.id, from: 'CREATED', to: 'QUEUED' },
    ctx.events.afterCommit,
  );
  await ctx.events.wakeWorkers();
  return { replay: false, id, status: 'QUEUED' };
}
