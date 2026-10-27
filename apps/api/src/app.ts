import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import pino, { type Logger } from 'pino';
import type { Redis } from 'ioredis';
import type { Pool } from '@engine/db';
import type { Storage } from '@engine/storage';
import type { Config } from './config.ts';
import type { AppContext } from './context.ts';
import { createMetrics, type Metrics } from './metrics.ts';
import { SafeRedis } from './redis.ts';
import { RateLimiter } from './ratelimit.ts';
import { EventBus } from './events.ts';
import { ApiError, isDbConnectionError } from './errors.ts';
import { authHook } from './auth/session.ts';
import { authRoutes } from './routes/auth.ts';
import { apiKeyRoutes } from './routes/apiKeys.ts';
import { executionRoutes } from './routes/executions.ts';
import { adminRoutes } from './routes/admin.ts';
import { opsRoutes } from './routes/ops.ts';

export interface AppDeps {
  config: Config;
  pool: Pool;
  readPool?: Pool;
  redis: Redis;
  storage: Storage;
  logger?: Logger;
  metrics?: Metrics;
}

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const logger =
    deps.logger ??
    pino({
      level: deps.config.NODE_ENV === 'test' ? 'silent' : 'info',
      // Defence in depth: never emit credentials even if something logs headers.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie'],
    });
  const metrics = deps.metrics ?? createMetrics();
  const redis = new SafeRedis(deps.redis, () => metrics.redisErrors.inc());
  deps.redis.on('error', () => {});
  const ctx: AppContext = {
    config: deps.config,
    pool: deps.pool,
    readPool: deps.readPool ?? deps.pool,
    redis,
    storage: deps.storage,
    metrics,
    rateLimiter: new RateLimiter(redis),
    events: new EventBus(redis, metrics),
    logger,
  };

  const app = Fastify({
    logger,
    bodyLimit: 2.5 * 1024 * 1024,
    disableRequestLogging: true,
    requestIdLogLabel: 'requestId',
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    },
    trustProxy: true,
  }) as unknown as FastifyInstance;

  // JSON only.
  app.removeContentTypeParser('text/plain');

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: deps.config.WEB_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-CSRF-Token', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'X-Truncated', 'Retry-After'],
  });
  await app.register(cookie);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
    (req as unknown as { startedAt: bigint }).startedAt = process.hrtime.bigint();
  });
  app.addHook('onRequest', authHook(ctx));
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'unmatched';
    const started = (req as unknown as { startedAt?: bigint }).startedAt;
    const seconds = started ? Number(process.hrtime.bigint() - started) / 1e9 : 0;
    metrics.httpRequests.inc({ method: req.method, route, status: String(reply.statusCode) });
    metrics.httpDuration.observe({ method: req.method, route }, seconds);
    if (route !== '/healthz' && route !== '/metrics' && route !== '/readyz') {
      req.log.info(
        {
          method: req.method,
          route,
          status: reply.statusCode,
          ms: Math.round(seconds * 1000),
          tenantId: req.auth?.tenantId,
          executionId: (req.params as { id?: string } | undefined)?.id,
        },
        'request',
      );
    }
  });

  app.setErrorHandler((err, req, reply) => {
    let status = 500;
    let code = 'internal';
    let message = 'internal error';
    if (err instanceof ApiError) {
      status = err.statusCode;
      code = err.code;
      message = err.message;
      for (const [k, v] of Object.entries(err.headers)) reply.header(k, v);
    } else if (isDbConnectionError(err)) {
      metrics.dbErrors.inc();
      status = 503;
      code = 'unavailable';
      message = 'database temporarily unavailable';
    } else if ((err as { $metadata?: unknown }).$metadata || (err as { name?: string }).name?.startsWith('S3')) {
      metrics.s3Errors.inc({ op: 'request' });
      status = 503;
      code = 'unavailable';
      message = 'object storage temporarily unavailable';
    } else if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      status = err.statusCode;
      code =
        status === 413 ? 'payload_too_large' : status === 415 ? 'unsupported_media_type' : 'bad_request';
      message = err.message;
    }
    if (status >= 500) req.log.error({ err: { name: err.name, message: err.message, code: (err as { code?: string }).code } }, 'request failed');
    reply.code(status).send({ error: { code, message, requestId: req.id } });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: 'not_found', message: 'route not found', requestId: req.id } });
  });

  await authRoutes(app, ctx);
  await apiKeyRoutes(app, ctx);
  await executionRoutes(app, ctx);
  await adminRoutes(app, ctx);
  await opsRoutes(app, ctx);

  app.addHook('onClose', async () => {
    await ctx.events.close();
  });

  return { app, ctx };
}
