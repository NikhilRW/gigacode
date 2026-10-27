import type { SafeRedis } from './redis.ts';
import { redisKeys } from '@engine/shared';

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Token bucket: capacity = per-minute limit, refilled continuously. Time is passed in by the
// caller (deterministic script, works on any Redis version). Returns {allowed, ms_until_next_token}.
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local rate = capacity / 60000.0
local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil then tokens = capacity; ts = now end
tokens = math.min(capacity, tokens + (now - ts) * rate)
local allowed = 0
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  wait = math.ceil((1 - tokens) / rate)
end
redis.call('HMSET', key, 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', key, 120000)
return {allowed, wait}
`;

/** Per-instance token bucket used when Redis is unavailable. */
export class MemoryTokenBucket {
  private readonly buckets = new Map<string, { tokens: number; ts: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  take(key: string, perMinute: number): RateDecision {
    const capacity = Math.max(1, perMinute);
    const rate = capacity / 60_000;
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: capacity, ts: t };
    b.tokens = Math.min(capacity, b.tokens + (t - b.ts) * rate);
    b.ts = t;
    let decision: RateDecision;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      decision = { allowed: true, retryAfterSeconds: 0 };
    } else {
      decision = { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - b.tokens) / rate / 1000)) };
    }
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.buckets.delete(this.buckets.keys().next().value!);
    return decision;
  }
}

export class RateLimiter {
  private readonly fallback = new MemoryTokenBucket();

  constructor(private readonly redis: SafeRedis) {}

  async take(tenantId: string, perMinute: number): Promise<RateDecision> {
    const result = await this.redis.safe(
      async (r) => (await r.eval(TOKEN_BUCKET_LUA, 1, redisKeys.rateLimit(tenantId), perMinute, Date.now())) as [number, number],
      null,
    );
    if (result) {
      const [allowed, waitMs] = result;
      return { allowed: allowed === 1, retryAfterSeconds: allowed === 1 ? 0 : Math.max(1, Math.ceil(waitMs / 1000)) };
    }
    // Redis down: conservative local limit (half the tenant rate per instance).
    return this.fallback.take(tenantId, Math.max(1, Math.floor(perMinute / 2)));
  }
}
