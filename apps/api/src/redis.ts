import { Redis } from 'ioredis';

/** Fail fast: when Redis is down, commands reject immediately instead of queueing. */
export function createRedis(url: string): Redis {
  return new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    commandTimeout: 1000,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
}

/**
 * Redis is an optimisation, never a dependency of a request succeeding.
 * Every call goes through `safe`, which returns `fallback` on any error.
 */
export class SafeRedis {
  constructor(
    readonly client: Redis,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  get ready(): boolean {
    return this.client.status === 'ready';
  }

  async safe<T>(fn: (r: Redis) => Promise<T>, fallback: T): Promise<T> {
    if (!this.ready) return fallback;
    try {
      return await fn(this.client);
    } catch (err) {
      this.onError(err);
      return fallback;
    }
  }
}
