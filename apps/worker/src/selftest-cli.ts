// Run only the sandbox self-test (used by infra/worker-vm/setup.sh and for debugging).
import { pino } from 'pino';
import { loadConfig } from './config.ts';
import { createDriver } from './main-driver.ts';

const config = loadConfig({ WORKER_DATABASE_URL: 'postgres://unused@localhost/x', S3_BUCKET: 'unused', ...process.env });
const log = pino();
try {
  await createDriver(config, log).selfTest();
  console.log('self-test passed');
} catch (err) {
  console.error('self-test FAILED:', (err as Error).message);
  process.exit(2);
}
