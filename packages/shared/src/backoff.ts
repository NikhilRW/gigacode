import { RETRY_BACKOFF_SECONDS } from './constants.ts';

/** Seconds to wait before the next attempt after an infrastructure failure of `attempt` (1-based). */
export function retryBackoffSeconds(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), RETRY_BACKOFF_SECONDS.length) - 1;
  return RETRY_BACKOFF_SECONDS[index]!;
}

/** Exponential backoff with full jitter, for S3/DB/Redis retries. */
export function jitteredBackoffMs(attempt: number, baseMs = 100, maxMs = 5000): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry an async operation with jittered backoff. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseMs = 200): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(baseMs + jitteredBackoffMs(i, baseMs));
    }
  }
  throw lastError;
}
