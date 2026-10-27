import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CACHE_TTL,
  isActive,
  isTerminal,
  listExecutionsQuerySchema,
  redisKeys,
  s3Keys,
  type ExecutionDetail,
  type ResultFile,
  type SourceManifest,
  type StatusEvent,
} from '@engine/shared';
import { AuthRepo, ExecutionRepo, isUuid, toExecution, toTenantLimits, transitionExecution } from '@engine/db';
import type { AppContext } from '../context.ts';
import { ApiError, isDbConnectionError, notFound } from '../errors.ts';
import { requireAuth, type AuthContext } from '../auth/session.ts';
import { submitExecution } from '../jobManager.ts';
import { parseBody } from './util.ts';

const INLINE_MAX = 1024 * 1024;
type IdReq = FastifyRequest<{ Params: { id: string } }>;

const staleKey = (tenantId: string, id: string) => `${redisKeys.execCache(tenantId, id)}:stale`;

export async function executionRoutes(app: FastifyInstance, ctx: AppContext) {
  const repo = (auth: AuthContext, read = false) => new ExecutionRepo(read ? ctx.readPool : ctx.pool, auth.tenantId);

  /** Read with replica → primary fallback. */
  async function readRow(auth: AuthContext, id: string) {
    if (!isUuid(id)) return null;
    if (ctx.readPool !== ctx.pool) {
      try {
        return await repo(auth, true).findRow(id);
      } catch {
        /* fall through to primary */
      }
    }
    return repo(auth).findRow(id);
  }

  async function mustFind(auth: AuthContext, id: string) {
    const row = await readRow(auth, id);
    if (!row) throw notFound('execution');
    return row;
  }

  async function loadDetail(auth: AuthContext, id: string): Promise<ExecutionDetail | null> {
    const row = await readRow(auth, id);
    if (!row) return null;
    const r = repo(auth, true);
    const [events, attempts] = await Promise.all([r.events(id), r.attempts(id)]);
    let files: { path: string; bytes: number }[] = [];
    try {
      const manifest = await ctx.storage.getJson<SourceManifest>(s3Keys.manifest(auth.tenantId, id));
      files = manifest.files.map((f) => ({ path: f.path, bytes: f.bytes }));
    } catch {
      /* manifest missing or S3 down: files stay empty */
    }
    return { ...toExecution(row), events, attempts, files };
  }

  app.post('/v1/executions', async (req, reply) => {
    const auth = requireAuth(req);
    const key = req.headers['idempotency-key'];
    const result = await submitExecution(ctx, auth, req.body, typeof key === 'string' ? key : undefined, req.log);
    reply.code(result.replay ? 200 : 202);
    return { id: result.id, status: result.status };
  });

  app.get('/v1/executions', async (req) => {
    const auth = requireAuth(req);
    const q = parseBody(listExecutionsQuerySchema, req.query);
    return repo(auth, true).list(q);
  });

  app.get('/v1/executions/:id', async (req: IdReq) => {
    const auth = requireAuth(req);
    const { id } = req.params;
    const cacheKey = redisKeys.execCache(auth.tenantId, id);
    const cached = await ctx.redis.safe(async (r) => r.get(cacheKey), null);
    if (cached) return JSON.parse(cached) as ExecutionDetail;
    let detail: ExecutionDetail | null;
    try {
      detail = await loadDetail(auth, id);
    } catch (err) {
      if (!isDbConnectionError(err)) throw err;
      // Degraded read: serve the last known copy if we have one.
      const stale = await ctx.redis.safe(async (r) => r.get(staleKey(auth.tenantId, id)), null);
      if (stale) return { ...(JSON.parse(stale) as ExecutionDetail), stale: true };
      throw err;
    }
    if (!detail) throw notFound('execution');
    const ttl = isTerminal(detail.status) ? CACHE_TTL.terminalSeconds : CACHE_TTL.activeSeconds;
    const json = JSON.stringify(detail);
    await ctx.redis.safe(
      (r) => r.multi().set(cacheKey, json, 'EX', ttl).set(staleKey(auth.tenantId, id), json, 'EX', 3600).exec(),
      null,
    );
    return detail;
  });

  app.get('/v1/executions/:id/source', async (req: IdReq) => {
    const auth = requireAuth(req);
    const row = await mustFind(auth, req.params.id);
    const manifest = await ctx.storage
      .getJson<SourceManifest>(s3Keys.manifest(auth.tenantId, row.id))
      .catch(() => {
        throw new ApiError(404, 'source_unavailable', 'source not available');
      });
    const files = await Promise.all(
      manifest.files.map(async (f) => ({
        path: f.path,
        content: await ctx.storage.getText(s3Keys.sourceFile(auth.tenantId, row.id, f.path)),
      })),
    );
    const stdin = await ctx.storage.getText(s3Keys.stdin(auth.tenantId, row.id)).catch(() => '');
    return { language: row.language, entryFile: row.entry_file, files, stdin, limits: row.limits };
  });

  const logsQuery = z.object({
    stream: z.enum(['stdout', 'stderr']).default('stdout'),
    inline: z.enum(['true', 'false']).optional(),
  });

  app.get('/v1/executions/:id/logs', async (req: IdReq, reply) => {
    const auth = requireAuth(req);
    const q = parseBody(logsQuery, req.query);
    const row = await mustFind(auth, req.params.id);
    const prefix = await repo(auth).authoritativeResultPrefix(row.id);
    if (!prefix) throw new ApiError(404, 'not_ready', 'logs are not available yet');
    const key = `${prefix}${q.stream}.log`;
    const truncated = q.stream === 'stdout' ? row.stdout_truncated : row.stderr_truncated;
    if (q.inline === 'true') {
      const body = await ctx.storage.getBuffer(key, INLINE_MAX).catch((err) => {
        if ((err as { name?: string }).name === 'NoSuchKey' || (err as { name?: string }).name === 'InvalidRange')
          return Buffer.alloc(0);
        throw err;
      });
      reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('X-Truncated', String(truncated))
        .header('Cache-Control', 'no-store');
      return reply.send(body);
    }
    const url = await ctx.storage.presignGet(key, 60);
    return { url, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  });

  app.get('/v1/executions/:id/result', async (req: IdReq) => {
    const auth = requireAuth(req);
    const row = await mustFind(auth, req.params.id);
    const prefix = isTerminal(row.status as never) ? await repo(auth).authoritativeResultPrefix(row.id) : null;
    if (!prefix) throw new ApiError(404, 'not_ready', 'result is not available yet');
    return ctx.storage.getJson<ResultFile>(`${prefix}result.json`);
  });

  app.post('/v1/executions/:id/cancel', async (req: IdReq, reply) => {
    const auth = requireAuth(req);
    const row = await mustFind(auth, req.params.id);
    const status = row.status as Parameters<typeof isActive>[0];
    if (status === 'QUEUED') {
      const res = await transitionExecution(
        ctx.pool,
        { id: row.id, tenantId: auth.tenantId, from: 'QUEUED', to: 'CANCELLED', detail: { by: 'user' } },
        ctx.events.afterCommit,
      );
      if (res.ok) {
        req.log.info({ tenantId: auth.tenantId, executionId: row.id }, 'cancelled while queued');
        const fresh = await repo(auth).findById(row.id);
        return fresh;
      }
    }
    // Re-read: the job may have been claimed between our read and the CAS above.
    const current = (await repo(auth).findRow(row.id))!;
    if (isActive(current.status as never)) {
      await repo(auth).requestCancel(row.id);
      await ctx.events.invalidate(auth.tenantId, row.id);
      req.log.info({ tenantId: auth.tenantId, executionId: row.id }, 'cancel requested');
      reply.code(202);
      return toExecution({ ...current, cancel_requested: true });
    }
    if (current.status === 'QUEUED') throw new ApiError(409, 'conflict', 'state changed, retry');
    throw new ApiError(409, 'not_cancellable', `execution is ${current.status}`);
  });

  app.get('/v1/executions/:id/events', async (req: IdReq, reply) => {
    const auth = requireAuth(req);
    if (auth.via !== 'cookie')
      throw new ApiError(400, 'session_required', 'event streams require a dashboard session; API clients should poll');
    const row = await mustFind(auth, req.params.id);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Request-Id': req.id,
    });
    let last = '';
    let closed = false;
    const send = (e: StatusEvent) => {
      if (closed) return;
      const key = `${e.status}:${e.attempt}`;
      if (key === last) return;
      last = key;
      res.write(`event: status\ndata: ${JSON.stringify(e)}\n\n`);
      if (isTerminal(e.status)) close();
    };
    const fromRow = (r: { id: string; status: string; attempt: number }): StatusEvent => ({
      id: r.id,
      status: r.status as StatusEvent['status'],
      attempt: r.attempt,
      at: new Date().toISOString(),
    });

    // Source of truth is the DB: every pub/sub message and every 2s tick re-reads the row.
    let polling = false;
    const refresh = async () => {
      if (closed || polling) return;
      polling = true;
      try {
        const fresh = await repo(auth).findRow(row.id);
        if (fresh) send(fromRow(fresh));
      } catch {
        /* DB blip: keep the stream open, try again next tick */
      } finally {
        polling = false;
      }
    };
    const unsubscribe = ctx.events.subscribe(row.id, () => void refresh());
    const poll = setInterval(() => void refresh(), 2000);
    const ping = setInterval(() => !closed && res.write(': ping\n\n'), 15_000);
    function close() {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      clearInterval(ping);
      unsubscribe();
      res.end();
    }
    req.raw.on('close', close);
    send(fromRow(row));
  });

  app.get('/v1/usage', async (req) => {
    const auth = requireAuth(req);
    const tenant = await new AuthRepo(ctx.readPool).findTenant(auth.tenantId);
    if (!tenant) throw notFound('tenant');
    const usage = await repo(auth, true).usage();
    return { ...usage, limits: toTenantLimits(tenant) };
  });
}
