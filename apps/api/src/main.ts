import pino from 'pino';
import { createPool } from '@engine/db';
import { Storage } from '@engine/storage';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import { createMetrics } from './metrics.ts';
import { createRedis } from './redis.ts';
import { Reaper } from './reaper.ts';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const logger = pino({ level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] });
const metrics = createMetrics();
const pool = createPool(config.DATABASE_URL, 20, () => metrics.dbErrors.inc());
const readPool = config.DATABASE_READ_URL ? createPool(config.DATABASE_READ_URL, 20, () => metrics.dbErrors.inc()) : undefined;
const redis = createRedis(config.REDIS_URL);
const storage = new Storage(
  {
    endpoint: config.S3_ENDPOINT,
    publicEndpoint: config.S3_PUBLIC_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  },
  (op) => metrics.s3Errors.inc({ op }),
);

const { app, ctx } = await buildApp({ config, pool, readPool, redis, storage, logger, metrics });
const reaper = new Reaper(ctx);
reaper.start();

await app.listen({ host: '0.0.0.0', port: config.API_PORT });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  await reaper.stop();
  await app.close();
  await pool.end().catch(() => {});
  await readPool?.end().catch(() => {});
  redis.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
