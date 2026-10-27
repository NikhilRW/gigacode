import { ensureWorkerLogin, migrateUp } from './migrate.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

await migrateUp(url);
console.log('migrations applied');

const workerPassword = process.env.WORKER_DB_PASSWORD;
if (workerPassword) {
  await ensureWorkerLogin(url, process.env.WORKER_DB_LOGIN ?? 'worker_login', workerPassword);
  console.log('worker login ensured');
}
