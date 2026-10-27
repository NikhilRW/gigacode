import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@engine/shared';
import { generateApiKey, parseApiKey, verifySecret } from '../src/auth/apikeys.ts';
import { MemoryTokenBucket } from '../src/ratelimit.ts';
import { loadConfig } from '../src/config.ts';

describe('api keys', () => {
  it('generates ce_live_<prefix>_<secret> and stores only the secret hash', () => {
    const k = generateApiKey();
    expect(k.key).toMatch(/^ce_live_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    const parsed = parseApiKey(k.key)!;
    expect(parsed.prefix).toBe(k.prefix);
    expect(k.hash).toBe(sha256Hex(parsed.secret));
    expect(k.hash).not.toContain(parsed.secret);
    expect(verifySecret(parsed.secret, k.hash)).toBe(true);
    expect(verifySecret(parsed.secret + 'x', k.hash)).toBe(false);
  });
  it('rejects malformed keys', () => {
    expect(parseApiKey('ce_live_short_x')).toBeNull();
    expect(parseApiKey('Bearer whatever')).toBeNull();
  });
});

describe('in-memory token bucket', () => {
  it('allows the burst, then rejects with a retry hint, then refills', () => {
    let now = 0;
    const b = new MemoryTokenBucket(() => now);
    expect(b.take('t', 2).allowed).toBe(true);
    expect(b.take('t', 2).allowed).toBe(true);
    const denied = b.take('t', 2);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    now += 30_000;
    expect(b.take('t', 2).allowed).toBe(true);
    expect(b.take('other', 2).allowed).toBe(true);
  });
});

describe('config', () => {
  it('fails fast with a readable message', () => {
    expect(() => loadConfig({})).toThrow(/JWT_SECRET|DATABASE_URL/);
  });
});
