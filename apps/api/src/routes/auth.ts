import { randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { changePasswordSchema, loginSchema, registerSchema, updateProfileSchema, type Me } from '@engine/shared';
import { AuthRepo, toTenantLimits, withTx, type UserRow } from '@engine/db';
import type { AppContext } from '../context.ts';
import { ApiError, unauthorized } from '../errors.ts';
import { clearSession, issueNativeSession, issueSession, requireAuth } from '../auth/session.ts';
import { parseBody } from './util.ts';

// algorithm 2 = Argon2id (const enum in @node-rs/argon2, not importable under isolatedModules)
const ARGON = { algorithm: 2 as const, memoryCost: 19456, timeCost: 2, parallelism: 1 };
// Verified against when the email is unknown, so response time does not reveal accounts.
const DUMMY_HASH_PROMISE = hash('not-a-real-password-0000', ARGON);

type AccountUser = Pick<UserRow, 'id' | 'email' | 'name' | 'role' | 'tenant_id'>;

async function buildMe(ctx: AppContext, user: AccountUser, csrf: string): Promise<Me> {
  const tenant = await new AuthRepo(ctx.pool).findTenant(user.tenant_id);
  if (!tenant) throw unauthorized();
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    tenant: { id: tenant.id, name: tenant.name },
    limits: toTenantLimits(tenant),
    csrfToken: csrf,
  };
}

async function registerAccount(ctx: AppContext, input: unknown): Promise<AccountUser> {
  const body = parseBody(registerSchema, input);
  const repo = new AuthRepo(ctx.pool);
  if (await repo.findUserByEmail(body.email)) throw new ApiError(409, 'email_taken', 'email already registered');
  const passwordHash = await hash(body.password, ARGON);
  const tenantId = randomUUID();
  const userId = randomUUID();
  try {
    await withTx(ctx.pool, (client) =>
      new AuthRepo(client).createTenantWithOwner({
        tenantId,
        tenantName: body.tenantName,
        userId,
        email: body.email,
        name: body.name,
        passwordHash,
      }),
    );
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new ApiError(409, 'email_taken', 'email already registered');
    throw err;
  }
  return { id: userId, email: body.email.toLowerCase(), name: body.name ?? null, role: 'owner', tenant_id: tenantId };
}

async function loginAccount(ctx: AppContext, input: unknown): Promise<AccountUser> {
  const body = parseBody(loginSchema, input);
  const user = await new AuthRepo(ctx.pool).findUserByEmail(body.email);
  const ok = user ? await verify(user.password_hash, body.password) : (await verify(await DUMMY_HASH_PROMISE, body.password), false);
  if (!user || !ok) throw new ApiError(401, 'invalid_credentials', 'invalid email or password');
  return user;
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  async function respondWithSession(reply: FastifyReply, user: AccountUser, mode: 'cookie' | 'native') {
    if (mode === 'native') {
      reply.header('Cache-Control', 'no-store');
      return {
        ...(await buildMe(ctx, user, '')),
        ...issueNativeSession(ctx, { id: user.id, tenantId: user.tenant_id, role: user.role }),
      };
    }
    const csrf = issueSession(ctx, reply, { id: user.id, tenantId: user.tenant_id, role: user.role });
    return buildMe(ctx, user, csrf);
  }

  for (const mode of ['cookie', 'native'] as const) {
    const base = mode === 'native' ? '/v1/auth/native' : '/v1/auth';
    app.post(`${base}/register`, async (req, reply) => {
      const user = await registerAccount(ctx, req.body);
      req.log.info({ tenantId: user.tenant_id, userId: user.id }, 'tenant registered');
      reply.code(201);
      return respondWithSession(reply, user, mode);
    });
    app.post(`${base}/login`, async (req, reply) => respondWithSession(reply, await loginAccount(ctx, req.body), mode));
  }

  app.post('/v1/auth/logout', async (req, reply) => {
    if (req.auth) requireAuth(req);
    clearSession(ctx, reply);
    reply.code(204).send();
  });

  app.get('/v1/me', async (req) => {
    const auth = requireAuth(req);
    if (auth.userId) {
      const user = await new AuthRepo(ctx.pool).findUserById(auth.userId);
      if (!user || user.tenant_id !== auth.tenantId) throw unauthorized();
      return buildMe(ctx, user, auth.csrf);
    }
    // API key caller: no user, report the tenant.
    const tenant = await new AuthRepo(ctx.pool).findTenant(auth.tenantId);
    if (!tenant) throw unauthorized();
    return {
      user: { id: auth.apiKeyId!, email: '', name: null, role: auth.role },
      tenant: { id: tenant.id, name: tenant.name },
      limits: toTenantLimits(tenant),
      csrfToken: '',
    } satisfies Me;
  });

  /** Profile and password changes need a cookie or native user session; API keys have no user. */
  function sessionUserId(req: Parameters<typeof requireAuth>[0]): { userId: string; tenantId: string; csrf: string } {
    const auth = requireAuth(req);
    if (auth.via === 'apikey' || !auth.userId)
      throw new ApiError(403, 'session_required', 'this action requires a signed-in dashboard session');
    return { userId: auth.userId, tenantId: auth.tenantId, csrf: auth.csrf };
  }

  app.patch('/v1/me', async (req) => {
    const { userId, tenantId, csrf } = sessionUserId(req);
    const body = parseBody(updateProfileSchema, req.body);
    const repo = new AuthRepo(ctx.pool);
    await repo.updateName(userId, body.name);
    const user = await repo.findUserById(userId);
    if (!user || user.tenant_id !== tenantId) throw unauthorized();
    return buildMe(ctx, user, csrf);
  });

  app.post('/v1/me/password', async (req, reply) => {
    const { userId, tenantId } = sessionUserId(req);
    const body = parseBody(changePasswordSchema, req.body);
    const repo = new AuthRepo(ctx.pool);
    const user = await repo.findUserById(userId);
    if (!user || user.tenant_id !== tenantId) throw unauthorized();
    if (!(await verify(user.password_hash, body.currentPassword)))
      throw new ApiError(400, 'wrong_password', 'current password is incorrect');
    await repo.updatePasswordHash(userId, await hash(body.newPassword, ARGON));
    req.log.info({ tenantId, userId }, 'password changed');
    reply.code(204).send();
  });
}
