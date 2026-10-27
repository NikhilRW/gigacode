export const DEFAULTS = {
  timeoutMs: 5000,
  memoryMb: 256,
  cpuMsPerSec: 1000,
  pids: 64,
  outputBytes: 1024 * 1024,
  fileSizeMb: 16,
  tmpfsMb: 64,
} as const;

export const HARD_LIMITS = {
  timeoutMs: 10_000,
  memoryMb: 512,
  cpuMsPerSec: 1000,
  pids: 64,
  maxFiles: 20,
  stdinBytes: 256 * 1024,
  queuedPerTenant: 200,
} as const;

export const COMPILE_LIMITS = { wallMs: 10_000, memoryMb: 512 } as const;

export const RETRY_BACKOFF_SECONDS = [5, 20, 60] as const;

export const CACHE_TTL = { activeSeconds: 2, terminalSeconds: 3600, apiKeySeconds: 60 } as const;
