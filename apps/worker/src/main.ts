import { hostname } from 'node:os';
import { pino } from 'pino';
import { createPool, PgJobQueue } from '@engine/db';
import { Storage } from '@engine/storage';
import { loadConfig } from './config.ts';
import { createDriver } from './main-driver.ts';
import { Hints } from './hints.ts';
import { Slot } from './slot.ts';

const VERSION = '0.1.0';
async function main() {
  const config = loadConfig();
  const log = pino({ base: { workerId: config.workerId, service: 'worker' } });
  const driver = createDriver(config, log);

  log.info({ driver: driver.name, slots: config.slots }, 'running sandbox self-test');
  try {
    await driver.selfTest();
  } catch (err) {
    log.fatal({ err: (err as Error).message }, 'sandbox self-test failed; refusing to claim jobs');
    process.exit(2);
  }
  log.info('self-test passed');

  const pool = createPool(config.WORKER_DATABASE_URL, config.slots + 2, (err) =>
    log.warn({ err: err.message }, 'db pool error'),
  );
  const queue = new PgJobQueue(pool);
  const storage = new Storage({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  });
  const hints = new Hints(config.REDIS_URL, log);
  const slots = Array.from({ length: config.slots }, (_, i) => new Slot(i, { config, queue, storage, driver, hints, log }));

  let status = 'active';
  const info = () => ({ id: config.workerId, hostname: hostname(), version: VERSION, slots: config.slots, status });
  const beat = async () => {
    const busy = slots.filter((s) => s.busy).length;
    await queue.register(info()).catch((err) => log.warn({ err: err.message }, 'worker heartbeat failed'));
    await hints.liveness(config.workerId, { ...info(), busy });
  };
  await beat();
  const beatTimer = setInterval(beat, config.HEARTBEAT_SECONDS * 1000);

  const loops = slots.map((s) => s.loop());
  log.info('claiming jobs');

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ sig, drainSeconds: config.DRAIN_SECONDS }, 'draining');
    status = 'draining';
    slots.forEach((s) => s.stop());
    await beat();
    const deadline = Date.now() + config.DRAIN_SECONDS * 1000;
    while (slots.some((s) => s.busy) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    // Still running: kill sandboxes; their leases expire and the reaper requeues them.
    slots.filter((s) => s.busy).forEach((s) => s.abortCurrent('shutdown'));
    await Promise.race([Promise.all(loops), new Promise((r) => setTimeout(r, 5000))]);
    clearInterval(beatTimer);
    status = 'stopped';
    await queue.register(info()).catch(() => {});
    await hints.close();
    await pool.end().catch(() => {});
    log.info('stopped');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
