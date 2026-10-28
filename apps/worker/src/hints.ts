import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { redisKeys, type StatusEvent } from '@engine/shared';

/**
 * Redis is advisory for the worker: wake-up hints, liveness, status pub/sub, counters.
 * Postgres stays the source of truth, so every call here swallows errors.
 */
export class Hints {
  private readonly redis: Redis;
  private readonly sub: Redis;
  /** Every idle slot waiting for a hint; a wake-up releases all of them. */
  private readonly waiters = new Set<() => void>();

  constructor(url: string, private readonly log: Logger) {
    const opts = { enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 2000, lazyConnect: false };
    this.redis = new Redis(url, { ...opts, commandTimeout: 1000 });
    this.sub = new Redis(url, { ...opts, enableOfflineQueue: true });
    for (const c of [this.redis, this.sub]) c.on('error', () => {});
    this.sub.subscribe(redisKeys.queueWake).catch(() => {});
    this.sub.on('message', () => [...this.waiters].forEach((wake) => wake()));
  }

  /** Sleep up to `ms`, returning early when the API publishes `queue:wake`. */
  waitForWork(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  publishStatus(tenantId: string, event: StatusEvent): void {
    const run = async () => {
      await this.redis.del(redisKeys.execCache(tenantId, event.id));
      await this.redis.publish(redisKeys.execChannel(event.id), JSON.stringify(event));
    };
    run().catch((err) => this.log.debug({ err: err.message }, 'redis publish skipped'));
  }

  async liveness(workerId: string, info: Record<string, unknown>): Promise<void> {
    await this.redis.set(redisKeys.worker(workerId), JSON.stringify(info), 'EX', 15).catch(() => {});
  }

  async countFenced(): Promise<void> {
    await this.redis.incr(redisKeys.fencedCounter).catch(() => {});
  }

  async close() {
    this.redis.disconnect();
    this.sub.disconnect();
  }
}
