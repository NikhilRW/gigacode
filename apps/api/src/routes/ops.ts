import type { FastifyInstance } from 'fastify';
import { redisKeys } from '@engine/shared';
import { PlatformRepo } from '@engine/db';
import type { AppContext } from '../context.ts';
import { buildOpenApi } from '../openapi.ts';

const withTimeout = <T>(p: Promise<T>, ms = 2000) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

export async function opsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_req, reply) => {
    const check = async (fn: () => Promise<unknown>) => {
      try {
        await withTimeout(fn());
        return 'ok';
      } catch {
        return 'down';
      }
    };
    const [postgres, redis, s3] = await Promise.all([
      check(() => ctx.pool.query('SELECT 1')),
      check(() => ctx.redis.client.ping()),
      check(() => ctx.storage.ping()),
    ]);
    const ok = postgres === 'ok' && redis === 'ok' && s3 === 'ok';
    reply.code(ok ? 200 : 503);
    return { status: ok ? 'ready' : 'degraded', postgres, redis, s3 };
  });

  const openapi = buildOpenApi();
  app.get('/docs', async () => openapi);

  // Not exposed publicly: the reverse proxy only forwards /v1.
  app.get('/metrics', async (_req, reply) => {
    const m = ctx.metrics;
    try {
      const q = await new PlatformRepo(ctx.readPool).queueStats();
      m.queueDepth.set(q.depth);
      m.oldestQueuedAge.set(q.oldestAgeSeconds);
    } catch {
      m.dbErrors.inc();
    }
    await ctx.redis.safe(async (r) => {
      let busy = 0;
      let total = 0;
      let cursor = '0';
      do {
        const [next, keys] = await r.scan(cursor, 'MATCH', redisKeys.workerPattern, 'COUNT', 200);
        cursor = next;
        if (keys.length) {
          for (const raw of await r.mget(...keys)) {
            if (!raw) continue;
            try {
              const w = JSON.parse(raw) as { busy?: number; slots?: number };
              busy += Number(w.busy ?? 0);
              total += Number(w.slots ?? 0);
            } catch {
              /* ignore */
            }
          }
        }
      } while (cursor !== '0');
      m.slotsBusy.set(busy);
      m.slotsTotal.set(total);
      m.fencedDiscarded.set(Number((await r.get(redisKeys.fencedCounter)) ?? 0));
    }, undefined);
    reply.header('Content-Type', m.registry.contentType);
    return m.registry.metrics();
  });
}
