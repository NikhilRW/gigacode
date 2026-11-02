import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { redisKeys, roleSchema, type Role } from '@engine/shared';
import { AuthRepo } from '@engine/db';
import type { AppContext } from '../context.ts';
import { ApiError, forbidden, unauthorized } from '../errors.ts';
import { parseApiKey, verifySecret } from './apikeys.ts';

export const SESSION_COOKIE = 'session';
export const NATIVE_SESSION_PREFIX = 'ce_session_';
const COOKIE_AUDIENCE = 'code-exec-cookie';
const NATIVE_AUDIENCE = 'code-exec-native';
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export interface AuthContext {
  tenantId: string;
  userId: string | null;
  apiKeyId: string | null;
  role: Role;
  via: 'cookie' | 'native' | 'apikey';
  csrf: string;
}

// Verification of a signature alone does not establish the shape or purpose of a JWT.
const userClaimsSchema = z.object({
  sub: z.string().uuid(),
  tid: z.string().uuid(),
  role: roleSchema,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});
const cookieClaimsSchema = userClaimsSchema.extend({
  csrf: z.string().min(1),
  aud: z.literal(COOKIE_AUDIENCE),
  type: z.literal('cookie_session'),
});
// Keep already-issued browser sessions valid for their original lifetime.
const legacyCookieClaimsSchema = cookieClaimsSchema.extend({ aud: z.undefined(), type: z.undefined() });
const nativeClaimsSchema = userClaimsSchema.extend({
  aud: z.literal(NATIVE_AUDIENCE),
  type: z.literal('native_session'),
});

type SessionUser = { id: string; tenantId: string; role: Role };

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export function issueSession(
  ctx: AppContext,
  reply: FastifyReply,
  user: SessionUser,
): string {
  const csrf = randomBytes(24).toString('base64url');
  const claims = { sub: user.id, tid: user.tenantId, role: user.role, csrf, type: 'cookie_session' };
  const token = jwt.sign(claims, ctx.config.JWT_SECRET, {
    algorithm: 'HS256', audience: COOKIE_AUDIENCE, expiresIn: SESSION_TTL_SECONDS,
  });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.COOKIE_SECURE,
    maxAge: SESSION_TTL_SECONDS,
  });
  return csrf;
}

/** Native sessions are bearer credentials, never cookies or browser CSRF secrets. */
export function issueNativeSession(ctx: AppContext, user: SessionUser): { token: string; expiresIn: number } {
  const token = jwt.sign(
    { sub: user.id, tid: user.tenantId, role: user.role, type: 'native_session' },
    ctx.config.JWT_SECRET,
    { algorithm: 'HS256', audience: NATIVE_AUDIENCE, expiresIn: SESSION_TTL_SECONDS },
  );
  return { token: `${NATIVE_SESSION_PREFIX}${token}`, expiresIn: SESSION_TTL_SECONDS };
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
    const payload = jwt.verify(token, ctx.config.JWT_SECRET, { algorithms: ['HS256'] });
    const parsed = z.union([cookieClaimsSchema, legacyCookieClaimsSchema]).safeParse(payload);
    if (!parsed.success) return null;
    const c = parsed.data;
    return { tenantId: c.tid, userId: c.sub, apiKeyId: null, role: c.role, via: 'cookie', csrf: c.csrf };
  } catch {
    return null;
  }
}

function authenticateNative(ctx: AppContext, token: string): AuthContext | null {
  try {
    const payload = jwt.verify(token.slice(NATIVE_SESSION_PREFIX.length), ctx.config.JWT_SECRET, {
      algorithms: ['HS256'], audience: NATIVE_AUDIENCE,
    });
    const parsed = nativeClaimsSchema.safeParse(payload);
    if (!parsed.success) return null;
    const c = parsed.data;
    return { tenantId: c.tid, userId: c.sub, apiKeyId: null, role: c.role, via: 'native', csrf: '' };
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
      const token = header.slice(7).trim();
      if (token.startsWith(NATIVE_SESSION_PREFIX)) {
        req.auth = authenticateNative(ctx, token);
        if (!req.auth) throw new ApiError(401, 'invalid_session', 'invalid or expired native session');
        return;
      }
      req.auth = await authenticateApiKey(ctx, token);
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
