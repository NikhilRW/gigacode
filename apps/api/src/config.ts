import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  COOKIE_SECURE: bool,
  DATABASE_URL: z.string().min(1),
  DATABASE_READ_URL: z.string().optional().transform((v) => v || undefined),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  S3_ENDPOINT: z.string().optional().transform((v) => v || undefined),
  S3_PUBLIC_ENDPOINT: z.string().optional().transform((v) => v || undefined),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('engine-artifacts'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  REAPER_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET.startsWith('change-me')) {
    throw new Error('Invalid environment configuration:\n  JWT_SECRET: must be changed in production');
  }
  return parsed.data;
}
