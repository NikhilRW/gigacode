import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { createPool, PgJobQueue, type ClaimedJob, type Completion, type Pool } from '@engine/db';
import { Storage } from '@engine/storage';
import { s3Keys, type Me, type ResultFile } from '@engine/shared';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createRedis } from '../src/redis.ts';
import type { AppContext } from '../src/context.ts';

const env = process.env;
export const DATABASE_URL = env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:5432/engine';
export const WORKER_DATABASE_URL =
  env.TEST_WORKER_DATABASE_URL ?? 'postgres://worker_login:worker-pass@localhost:5432/engine';

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  pool: Pool;
  workerPool: Pool;
  queue: PgJobQueue;
  storage: Storage;
  close: () => Promise<void>;
}

export async function setup(): Promise<TestEnv> {
  const config = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-0123456789abcdef',
    DATABASE_URL,
    REDIS_URL: env.TEST_REDIS_URL ?? 'redis://localhost:6379',
    S3_ENDPOINT: env.TEST_S3_ENDPOINT ?? 'http://localhost:9000',
    S3_ACCESS_KEY_ID: 'minio',
    S3_SECRET_ACCESS_KEY: 'minio12345',
    S3_FORCE_PATH_STYLE: 'true',
    COOKIE_SECURE: 'false',
  });
  const pool = createPool(DATABASE_URL);
  // These tests drive the queue with a stub worker; a real worker on the same DB would steal jobs.
  const live = await pool.query<{ id: string }>(
    `SELECT id FROM workers WHERE status = 'active' AND last_heartbeat_at > now() - interval '15 seconds' AND id NOT LIKE 'stub-%'`,
  );
  if (live.rows.length > 0) {
    await pool.end();
    throw new Error(
      `a real worker (${live.rows.map((r) => r.id).join(', ')}) is attached to this database; ` +
        'stop it first (docker compose stop worker) before running integration tests',
    );
  }
  // Test files share one queue; hold a session advisory lock so they never interleave.
  const lockClient = await pool.connect();
  await lockClient.query('SELECT pg_advisory_lock(424242)');
  const workerPool = createPool(WORKER_DATABASE_URL);
  const redis = createRedis(config.REDIS_URL);
  await new Promise<void>((resolve) => (redis.status === 'ready' ? resolve() : redis.once('ready', () => resolve())));
  const storage = new Storage({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: true,
  });
  await storage.ensureBucket();
  const { app, ctx } = await buildApp({ config, pool, redis, storage });
  await app.ready();
  return {
    app,
    ctx,
    pool,
    workerPool,
    queue: new PgJobQueue(workerPool),
    storage,
    close: async () => {
      await app.close();
      await lockClient.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
      lockClient.release();
      await pool.end();
      await workerPool.end();
      redis.disconnect();
    },
  };
}

/** Integration tests assume no real worker is attached to this DB; park leftovers from older runs. */
export async function drainQueue(pool: Pool): Promise<void> {
  await pool.query(
    `UPDATE executions SET status = 'CANCELLED', finished_at = now(), lease_owner = NULL, lease_expires_at = NULL
     WHERE status IN ('CREATED', 'QUEUED', 'DISPATCHED', 'STARTING', 'RUNNING')`,
  );
  await pool.query('UPDATE tenant_concurrency SET running = 0');
}

export class Client {
  constructor(
    readonly app: FastifyInstance,
    readonly cookie: string,
    readonly me: Me,
  ) {}

  get csrf() {
    return this.me.csrfToken;
  }

  get(path: string) {
    return request(this.app.server).get(path).set('Cookie', this.cookie);
  }
  post(path: string, body?: object, headers: Record<string, string> = {}) {
    const r = request(this.app.server).post(path).set('Cookie', this.cookie).set('x-csrf-token', this.csrf).set(headers);
    return body ? r.send(body) : r;
  }
  patch(path: string, body: object) {
    return request(this.app.server).patch(path).set('Cookie', this.cookie).set('x-csrf-token', this.csrf).send(body);
  }
  delete(path: string) {
    return request(this.app.server).delete(path).set('Cookie', this.cookie).set('x-csrf-token', this.csrf);
  }
}

export async function newTenant(t: TestEnv, opts: { admin?: boolean } = {}): Promise<Client> {
  const email = `t-${randomUUID()}@example.com`;
  const password = 'correct-horse-battery';
  const reg = await request(t.app.server)
    .post('/v1/auth/register')
    .send({ tenantName: `tenant ${email.slice(2, 10)}`, email, password });
  if (reg.status !== 201) throw new Error(`register failed ${reg.status} ${JSON.stringify(reg.body)}`);
  if (opts.admin) {
    await t.pool.query(`UPDATE users SET role = 'platform_admin' WHERE email = $1`, [email]);
    const login = await request(t.app.server).post('/v1/auth/login').send({ email, password });
    return new Client(t.app, cookieOf(login.headers['set-cookie']), login.body as Me);
  }
  return new Client(t.app, cookieOf(reg.headers['set-cookie']), reg.body as Me);
}

function cookieOf(setCookie: unknown): string {
  const list = (Array.isArray(setCookie) ? setCookie : [setCookie]) as string[];
  return list.map((c) => c.split(';')[0]).join('; ');
}

export const pyJob = (code = 'print("hi")', extra: object = {}) => ({
  language: 'python',
  files: [{ path: 'main.py', content: code }],
  entryFile: 'main.py',
  ...extra,
});

/** Stub worker: does what apps/worker does, minus the sandbox. */
export async function claimFor(t: TestEnv, executionId: string, workerId = `stub-${randomUUID().slice(0, 8)}`) {
  for (let i = 0; i < 20; i++) {
    const job = await t.queue.claim(workerId, 30);
    if (!job) return null;
    if (job.id === executionId) return { job, workerId };
    // A job from another test: finish it so it does not linger.
    await finish(t, job, workerId, { stdout: '' });
  }
  return null;
}

export async function finish(
  t: TestEnv,
  job: ClaimedJob,
  workerId: string,
  opts: { stdout: string; stderr?: string; status?: Completion['status']; exitCode?: number },
): Promise<boolean> {
  const status = opts.status ?? 'SUCCESS';
  if (status !== 'CANCELLED') {
    await t.queue.advance(job, workerId, 'DISPATCHED', 'STARTING');
    await t.queue.advance(job, workerId, 'STARTING', 'RUNNING');
  }
  const prefix = s3Keys.attemptPrefix(job.tenantId, job.id, job.attempt);
  const result: ResultFile = {
    executionId: job.id,
    attempt: job.attempt,
    status,
    exitCode: opts.exitCode ?? 0,
    termSignal: null,
    failureReason: null,
    wallMs: 12,
    cpuMs: 8,
    peakMemoryBytes: 1024 * 1024,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutBytes: Buffer.byteLength(opts.stdout),
    stderrBytes: Buffer.byteLength(opts.stderr ?? ''),
    compile: null,
  };
  await t.storage.put(`${prefix}stdout.log`, opts.stdout);
  await t.storage.put(`${prefix}stderr.log`, opts.stderr ?? '');
  await t.storage.put(`${prefix}result.json`, JSON.stringify(result));
  return t.queue.complete(job, workerId, {
    status,
    exitCode: result.exitCode,
    termSignal: null,
    failureReason: null,
    wallMs: 12,
    cpuMs: 8,
    peakMemoryBytes: 1024 * 1024,
    stdoutTruncated: false,
    stderrTruncated: false,
    resultPrefix: prefix,
  });
}
