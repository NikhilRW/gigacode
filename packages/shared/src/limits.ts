import { DEFAULTS, HARD_LIMITS } from './constants.ts';
import type { Limits } from './schemas.ts';

export interface TenantLimitCaps {
  maxTimeoutMs: number;
  maxMemoryMb: number;
}

export type LimitResolution = { ok: true; limits: Limits } | { ok: false; field: keyof Limits; max: number };

/**
 * Fill defaults and check requested limits against tenant caps and platform hard limits.
 * Requests above a cap are rejected, never silently raised or lowered.
 */
export function resolveLimits(requested: Partial<Limits>, caps: TenantLimitCaps): LimitResolution {
  const max: Limits = {
    timeoutMs: Math.min(caps.maxTimeoutMs, HARD_LIMITS.timeoutMs),
    memoryMb: Math.min(caps.maxMemoryMb, HARD_LIMITS.memoryMb),
    cpuMsPerSec: HARD_LIMITS.cpuMsPerSec,
    pids: HARD_LIMITS.pids,
  };
  const limits: Limits = {
    timeoutMs: requested.timeoutMs ?? Math.min(DEFAULTS.timeoutMs, max.timeoutMs),
    memoryMb: requested.memoryMb ?? Math.min(DEFAULTS.memoryMb, max.memoryMb),
    cpuMsPerSec: requested.cpuMsPerSec ?? DEFAULTS.cpuMsPerSec,
    pids: requested.pids ?? DEFAULTS.pids,
  };
  for (const field of Object.keys(max) as (keyof Limits)[]) {
    if (limits[field] > max[field]) return { ok: false, field, max: max[field] };
  }
  return { ok: true, limits };
}
