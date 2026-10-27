import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { redisKeys, type Role } from '@engine/shared';
import { AuthRepo } from '@engine/db';
import type { AppContext } from '../context.ts';
import { ApiError, forbidden, unauthorized } from '../errors.ts';
import { parseApiKey, verifySecret } from './apikeys.ts';

export const SESSION_COOKIE = 'session';
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export interface AuthContext {
  tenantId: string;
  userId: string | null;
  apiKeyId: string | null;
  role: Role;
  via: 'cookie' | 'apikey';
  csrf: string;
}

interface SessionClaims {
  sub: string;
  tid: string;
  role: Role;
  csrf: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export function issueSession(
  ctx: AppContext,
  reply: FastifyReply,
  user: { id: string; tenantId: string; role: Role },
): string {
  const csrf = randomBytes(24).toString('base64url');
  const claims: SessionClaims = { sub: user.id, tid: user.tenantId, role: user.role, csrf };
  const token = jwt.sign(claims, ctx.config.JWT_SECRET, { algorithm: 'HS256', expiresIn: SESSION_TTL_SECONDS });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.COOKIE_SECURE,
    maxAge: SESSION_TTL_SECONDS,
  });
  return csrf;
}

export function clearSession(ctx: AppContext, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: ctx.config.COOKIE_SECURE });
}

interface CachedKey {
  id: string;
  tenantId: string;
  keyHash: string;
  revoked: boolean;
}

async function authenticateApiKey(ctx: AppContext, raw: string): Promise<AuthContext | null> {
  const parsed = parseApiKey(raw);
  if (!parsed) return null;
  const cacheKey = redisKeys.apiKeyCache(parsed.prefix);
  let record = await ctx.redis.safe(async (r) => {
    const v = await r.get(cacheKey);
    return v ? (JSON.parse(v) as CachedKey) : null;
  }, null);
  if (!record) {
    record = await new AuthRepo(ctx.pool).findApiKeyByPrefix(parsed.prefix);
    if (!record) return null;
    const toCache = record;
    await ctx.redis.safe((r) => r.set(cacheKey, JSON.stringify(toCache), 'EX', 60), null);
  }
  if (record.revoked || !verifySecret(parsed.secret, record.keyHash)) return null;
  const keyId = record.id;
  void new AuthRepo(ctx.pool).touchApiKey(keyId).catch(() => {});
  return { tenantId: record.tenantId, userId: null, apiKeyId: keyId, role: 'member', via: 'apikey', csrf: '' };
}

function authenticateCookie(ctx: AppContext, token: string): AuthContext | null {
  try {
    const c = jwt.verify(token, ctx.config.JWT_SECRET, { algorithms: ['HS256'] }) as SessionClaims;
    return { tenantId: c.tid, userId: c.sub, apiKeyId: null, role: c.role, via: 'cookie', csrf: c.csrf };
  } catch {
    return null;
  }
}

/** onRequest hook: resolve the caller. Does not reject; route guards do. */
export function authHook(ctx: AppContext) {
  return async (req: FastifyRequest) => {
    req.auth = null;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      req.auth = await authenticateApiKey(ctx, header.slice(7).trim());
      if (!req.auth) throw new ApiError(401, 'invalid_api_key', 'invalid or revoked API key');
      return;
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.auth = authenticateCookie(ctx, token);
  };
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Returns the caller or throws 401. Enforces double-submit CSRF for cookie sessions. */
export function requireAuth(req: FastifyRequest): AuthContext {
  const auth = req.auth;
  if (!auth) throw unauthorized();
  if (auth.via === 'cookie' && STATE_CHANGING.has(req.method)) {
    const header = req.headers['x-csrf-token'];
    if (typeof header !== 'string' || header !== auth.csrf) throw new ApiError(403, 'csrf_failed', 'missing or invalid CSRF token');
  }
  return auth;
}

export function requireAdmin(req: FastifyRequest): AuthContext {
  const auth = requireAuth(req);
  if (auth.role !== 'platform_admin') throw forbidden();
  return auth;
}
