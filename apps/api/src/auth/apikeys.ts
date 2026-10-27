import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sha256Hex } from '@engine/shared';

const KEY_RE = /^ce_live_([a-z0-9]{12})_([A-Za-z0-9_-]{32,64})$/;

export interface GeneratedKey {
  key: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedKey {
  const prefix = randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0').slice(0, 12);
  const secret = randomBytes(32).toString('base64url');
  return { key: `ce_live_${prefix}_${secret}`, prefix, hash: sha256Hex(secret) };
}

export function parseApiKey(key: string): { prefix: string; secret: string } | null {
  const m = KEY_RE.exec(key);
  return m ? { prefix: m[1]!, secret: m[2]! } : null;
}

/** Constant-time comparison of sha256(secret) against the stored hash. */
export function verifySecret(secret: string, storedHash: string): boolean {
  const a = Buffer.from(sha256Hex(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
