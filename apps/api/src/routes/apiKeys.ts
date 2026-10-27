import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createApiKeySchema, redisKeys, type CreatedApiKey } from '@engine/shared';
import { ApiKeyRepo } from '@engine/db';
import type { AppContext } from '../context.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireAuth } from '../auth/session.ts';
import { generateApiKey } from '../auth/apikeys.ts';
import { parseBody } from './util.ts';

export async function apiKeyRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/v1/api-keys', async (req, reply) => {
    const auth = requireAuth(req);
    if (auth.via !== 'cookie') throw new ApiError(403, 'forbidden', 'API keys are managed from a dashboard session');
    const body = parseBody(createApiKeySchema, req.body);
    const generated = generateApiKey();
    const key = await new ApiKeyRepo(ctx.pool, auth.tenantId).create({
      id: randomUUID(),
      name: body.name,
      prefix: generated.prefix,
      keyHash: generated.hash,
    });
    req.log.info({ tenantId: auth.tenantId, apiKeyId: key.id }, 'api key created');
    reply.code(201);
    return { ...key, key: generated.key } satisfies CreatedApiKey;
  });

  app.get('/v1/api-keys', async (req) => {
    const auth = requireAuth(req);
    return { items: await new ApiKeyRepo(ctx.readPool, auth.tenantId).list() };
  });

  app.delete<{ Params: { id: string } }>('/v1/api-keys/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const prefix = await new ApiKeyRepo(ctx.pool, auth.tenantId).revoke(req.params.id);
    if (!prefix) throw notFound('api key');
    await ctx.redis.safe((r) => r.del(redisKeys.apiKeyCache(prefix)), 0);
    req.log.info({ tenantId: auth.tenantId, apiKeyId: req.params.id }, 'api key revoked');
    reply.code(204).send();
  });
}
