import { hostname, availableParallelism } from 'node:os';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WORKER_DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default('false'),
  WORKER_ID: z.string().optional(),
  WORKER_SLOTS: z.string().optional(),
  LEASE_SECONDS: z.coerce.number().int().min(3).default(30),
  HEARTBEAT_SECONDS: z.coerce.number().int().min(1).default(5),
  POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(500),
  DRAIN_SECONDS: z.coerce.number().int().min(0).default(30),
  SANDBOX_DRIVER: z.enum(['nsjail', 'docker']).default('nsjail'),
  SANDBOX_ROOTFS_DIR: z.string().default('/opt/sandbox/rootfs'),
  SANDBOX_SECCOMP_DIR: z.string().default('infra/nsjail/seccomp'),
  NSJAIL_BIN: z.string().default('/usr/local/bin/nsjail'),
  RUNS_DIR: z.string().default('/var/lib/worker/runs'),
  WORKER_LANGUAGES: z.string().default('python,node,c,cpp'),
  /** Chaos testing only (ignored in production): stop extending leases to simulate a partition. */
  CHAOS_DROP_HEARTBEATS: bool.default('false'),
});

export type WorkerConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  // Treat empty strings from .env files as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(`Invalid worker configuration:\n${issues}`);
    process.exit(1);
  }
  const c = parsed.data;
  if (c.SANDBOX_DRIVER === 'docker' && c.NODE_ENV === 'production') {
    console.error('SANDBOX_DRIVER=docker is not allowed when NODE_ENV=production');
    process.exit(1);
  }
  return {
    ...c,
    workerId: c.WORKER_ID ?? `${hostname()}-${randomBytes(3).toString('hex')}`,
    slots: c.WORKER_SLOTS ? Number(c.WORKER_SLOTS) : availableParallelism(),
    languages: c.WORKER_LANGUAGES.split(',').map((s) => s.trim()) as ('python' | 'node' | 'c' | 'cpp')[],
    chaosDropHeartbeats: c.CHAOS_DROP_HEARTBEATS && c.NODE_ENV !== 'production',
  };
}
