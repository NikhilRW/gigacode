import type { FastifyInstance, FastifyRequest } from 'fastify';
import { redisKeys, tenantLimitsPatchSchema, type WorkerInfo } from '@engine/shared';
import { PlatformRepo, toExecution, transitionExecution } from '@engine/db';
import type { AppContext } from '../context.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireAdmin } from '../auth/session.ts';
import { parseBody } from './util.ts';

type IdReq = FastifyRequest<{ Params: { id: string } }>;
const ALIVE_SECONDS = 30;

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const platform = () => new PlatformRepo(ctx.pool);

  app.get('/v1/admin/workers', async (req) => {
    requireAdmin(req);
    const rows = await new PlatformRepo(ctx.readPool).workers();
    const live = await ctx.redis.safe(
      async (r) => (rows.length ? await r.mget(...rows.map((w) => redisKeys.worker(w.id))) : []),
      [] as (string | null)[],
    );
    const items: WorkerInfo[] = rows.map((w, i) => {
      let busy: number | null = null;
      const raw = live[i];
      if (raw) {
        try {
          busy = Number((JSON.parse(raw) as { busy?: number }).busy ?? null);
        } catch {
          /* ignore malformed */
        }
      }
      return {
        id: w.id,
        hostname: w.hostname,
        version: w.version,
        slots: w.slots,
        busy,
        status: w.status,
        alive: w.status !== 'dead' && Date.now() - w.last_heartbeat_at.getTime() < ALIVE_SECONDS * 1000,
        startedAt: w.started_at.toISOString(),
        lastHeartbeatAt: w.last_heartbeat_at.toISOString(),
      };
    });
    return { items };
  });

  app.get('/v1/admin/queue', async (req) => {
    requireAdmin(req);
    return new PlatformRepo(ctx.readPool).queueStats();
  });

  app.get('/v1/admin/dlq', async (req) => {
    requireAdmin(req);
    return { items: await new PlatformRepo(ctx.readPool).deadLettered() };
  });

  app.post('/v1/admin/dlq/:id/requeue', async (req: IdReq) => {
    requireAdmin(req);
    const row = await platform().findExecution(req.params.id);
    if (!row) throw notFound('execution');
    if (row.status !== 'DEAD_LETTERED') throw new ApiError(409, 'not_dead_lettered', `execution is ${row.status}`);
    const res = await transitionExecution(
      ctx.pool,
      {
        id: row.id,
        from: 'DEAD_LETTERED',
        to: 'QUEUED',
        // Attempt numbers keep increasing so S3 keys and attempt rows never collide.
        set: { max_attempts: row.attempt + 3, failure_reason: null },
        availableAfterSeconds: 0,
        detail: { by: 'admin_requeue' },
      },
      ctx.events.afterCommit,
    );
    if (!res.ok) throw new ApiError(409, 'conflict', 'state changed, retry');
    await ctx.events.wakeWorkers();
    req.log.info({ executionId: row.id, tenantId: row.tenant_id }, 'dead-lettered execution requeued');
    return toExecution((await platform().findExecution(row.id))!);
  });

  app.get('/v1/admin/tenants', async (req) => {
    requireAdmin(req);
    return { items: await new PlatformRepo(ctx.readPool).tenants() };
  });

  app.patch('/v1/admin/tenants/:id/limits', async (req: IdReq) => {
    requireAdmin(req);
    const patch = parseBody(tenantLimitsPatchSchema, req.body);
    const tenant = await platform().updateTenantLimits(req.params.id, patch);
    if (!tenant) throw notFound('tenant');
    req.log.info({ tenantId: tenant.id }, 'tenant limits updated');
    return tenant;
  });
}
