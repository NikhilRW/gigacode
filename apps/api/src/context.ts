import type { Logger } from 'pino';
import type { Pool } from '@engine/db';
import type { Storage } from '@engine/storage';
import type { Config } from './config.ts';
import type { Metrics } from './metrics.ts';
import type { SafeRedis } from './redis.ts';
import type { RateLimiter } from './ratelimit.ts';
import type { EventBus } from './events.ts';

/** Everything route handlers and background tasks need. Built once in buildApp. */
export interface AppContext {
  config: Config;
  pool: Pool;
  /** Read replica when DATABASE_READ_URL is set, else the primary. */
  readPool: Pool;
  redis: SafeRedis;
  storage: Storage;
  metrics: Metrics;
  rateLimiter: RateLimiter;
  events: EventBus;
  logger: Logger;
}
