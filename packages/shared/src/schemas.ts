import { z } from 'zod';
import { EXECUTION_STATES, FAILURE_REASONS } from './states.ts';
import { LANGUAGE_IDS, type LanguageId } from './languages.ts';
import { HARD_LIMITS } from './constants.ts';
import { isSafeRelativePath } from './paths.ts';

export const languageSchema = z.enum(LANGUAGE_IDS as [LanguageId, ...LanguageId[]]);
export const statusSchema = z.enum(EXECUTION_STATES);
export const failureReasonSchema = z.enum(FAILURE_REASONS);

export const fileSchema = z.object({
  path: z.string().refine(isSafeRelativePath, 'unsafe file path'),
  content: z.string(),
});

export const limitsInputSchema = z
  .object({
    timeoutMs: z.number().int().positive().optional(),
    memoryMb: z.number().int().positive().optional(),
    cpuMsPerSec: z.number().int().positive().optional(),
    pids: z.number().int().positive().optional(),
  })
  .strict();

export const createExecutionSchema = z
  .object({
    language: languageSchema,
    files: z.array(fileSchema).min(1).max(HARD_LIMITS.maxFiles),
    entryFile: z.string().refine(isSafeRelativePath, 'unsafe entry file'),
    stdin: z.string().max(HARD_LIMITS.stdinBytes).default(''),
    limits: limitsInputSchema.default({}),
    priority: z.number().int().min(0).max(10).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const paths = body.files.map((f) => f.path);
    if (new Set(paths).size !== paths.length)
      ctx.addIssue({ code: 'custom', path: ['files'], message: 'duplicate file path' });
    if (!paths.includes(body.entryFile))
      ctx.addIssue({ code: 'custom', path: ['entryFile'], message: 'entryFile not in files' });
    if (Buffer.byteLength(body.stdin) > HARD_LIMITS.stdinBytes)
      ctx.addIssue({ code: 'custom', path: ['stdin'], message: 'stdin too large' });
  });
export type CreateExecutionInput = z.input<typeof createExecutionSchema>;
export type CreateExecutionRequest = z.output<typeof createExecutionSchema>;

export const limitsSchema = z.object({
  timeoutMs: z.number().int(),
  memoryMb: z.number().int(),
  cpuMsPerSec: z.number().int(),
  pids: z.number().int(),
});
export type Limits = z.infer<typeof limitsSchema>;

export const executionSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  language: languageSchema,
  entryFile: z.string(),
  status: statusSchema,
  priority: z.number(),
  limits: limitsSchema,
  attempt: z.number(),
  maxAttempts: z.number(),
  cancelRequested: z.boolean(),
  exitCode: z.number().nullable(),
  termSignal: z.string().nullable(),
  failureReason: z.string().nullable(),
  wallMs: z.number().nullable(),
  cpuMs: z.number().nullable(),
  peakMemoryBytes: z.number().nullable(),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
  createdAt: z.string(),
  queuedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type Execution = z.infer<typeof executionSchema>;

export const executionEventSchema = z.object({
  id: z.number(),
  attempt: z.number(),
  fromStatus: statusSchema.nullable(),
  toStatus: statusSchema,
  at: z.string(),
  detail: z.record(z.unknown()).nullable(),
});
export type ExecutionEvent = z.infer<typeof executionEventSchema>;

export const executionAttemptSchema = z.object({
  attempt: z.number(),
  workerId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  outcome: z.string().nullable(),
  exitCode: z.number().nullable(),
});
export type ExecutionAttempt = z.infer<typeof executionAttemptSchema>;

export const executionDetailSchema = executionSchema.extend({
  events: z.array(executionEventSchema),
  attempts: z.array(executionAttemptSchema),
  files: z.array(z.object({ path: z.string(), bytes: z.number() })),
});
export type ExecutionDetail = z.infer<typeof executionDetailSchema>;

export const listExecutionsQuerySchema = z.object({
  status: statusSchema.optional(),
  language: languageSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Run ID prefix (hex and dashes only), for the Runs search box. */
  q: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f-]{1,36}$/, 'q must be a run ID or its first characters')
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListExecutionsQuery = z.infer<typeof listExecutionsQuerySchema>;

export const executionListSchema = z.object({ items: z.array(executionSchema), nextCursor: z.string().nullable() });
export type ExecutionList = z.infer<typeof executionListSchema>;

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  tenantName: z.string().min(2).max(80),
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
});
export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

export const roleSchema = z.enum(['owner', 'member', 'platform_admin']);
export type Role = z.infer<typeof roleSchema>;

export const tenantLimitsSchema = z.object({
  maxConcurrent: z.number(),
  maxExecPerMin: z.number(),
  maxTimeoutMs: z.number(),
  maxMemoryMb: z.number(),
  maxSourceBytes: z.number(),
});
export type TenantLimits = z.infer<typeof tenantLimitsSchema>;

export const meSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string().nullable(), role: roleSchema }),
  tenant: z.object({ id: z.string(), name: z.string() }),
  limits: tenantLimitsSchema,
  csrfToken: z.string(),
});
export type Me = z.infer<typeof meSchema>;

export const updateProfileSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(200) })
  .strict();

/** Setup checklist state, derived from existing rows (no separate table). */
export const onboardingSchema = z.object({
  ranExecution: z.boolean(),
  createdApiKey: z.boolean(),
  usedApiKey: z.boolean(),
});
export type Onboarding = z.infer<typeof onboardingSchema>;

export const timeseriesQuerySchema = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) });
export const timeseriesSchema = z.object({
  hours: z.number(),
  points: z.array(
    z.object({
      at: z.string(),
      success: z.number(),
      failed: z.number(),
      timeout: z.number(),
      cancelled: z.number(),
      other: z.number(),
    }),
  ),
});
export type Timeseries = z.infer<typeof timeseriesSchema>;

export const createApiKeySchema = z.object({ name: z.string().min(1).max(80) });
export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;
export const createdApiKeySchema = apiKeySchema.extend({ key: z.string() });
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

export const tenantLimitsPatchSchema = z
  .object({
    maxConcurrent: z.number().int().min(1).max(256),
    maxExecPerMin: z.number().int().min(1).max(100_000),
    maxTimeoutMs: z.number().int().min(100).max(HARD_LIMITS.timeoutMs),
    maxMemoryMb: z.number().int().min(16).max(HARD_LIMITS.memoryMb),
    maxSourceBytes: z.number().int().min(1024).max(16 * 1024 * 1024),
  })
  .partial()
  .strict();
export type TenantLimitsPatch = z.infer<typeof tenantLimitsPatchSchema>;

export const usageSchema = z.object({
  executionsToday: z.number(),
  running: z.number(),
  queued: z.number(),
  totalCpuMs: z.number(),
  successRate24h: z.number().nullable(),
  limits: tenantLimitsSchema,
});
export type Usage = z.infer<typeof usageSchema>;

export const resultFileSchema = z.object({
  executionId: z.string(),
  attempt: z.number(),
  status: statusSchema,
  exitCode: z.number().nullable(),
  termSignal: z.string().nullable(),
  failureReason: z.string().nullable(),
  wallMs: z.number(),
  cpuMs: z.number(),
  peakMemoryBytes: z.number(),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
  stdoutBytes: z.number(),
  stderrBytes: z.number(),
  compile: z.object({ exitCode: z.number().nullable(), wallMs: z.number() }).nullable(),
});
export type ResultFile = z.infer<typeof resultFileSchema>;

export const logLinkSchema = z.object({ url: z.string(), expiresAt: z.string() });

/** Admin views */
export const workerInfoSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  version: z.string(),
  slots: z.number(),
  busy: z.number().nullable(),
  status: z.string(),
  alive: z.boolean(),
  startedAt: z.string(),
  lastHeartbeatAt: z.string(),
});
export type WorkerInfo = z.infer<typeof workerInfoSchema>;

export const queueStatsSchema = z.object({
  depth: z.number(),
  oldestAgeSeconds: z.number(),
  byTenant: z.array(
    z.object({ tenantId: z.string(), tenantName: z.string(), queued: z.number(), running: z.number() }),
  ),
});
export type QueueStats = z.infer<typeof queueStatsSchema>;

export const adminTenantSchema = z.object({ id: z.string(), name: z.string(), createdAt: z.string() }).merge(tenantLimitsSchema);
export type AdminTenant = z.infer<typeof adminTenantSchema>;

export const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

/** Payload published on Redis `exec:{id}` and sent over SSE. */
export const statusEventSchema = z.object({ id: z.string(), status: statusSchema, attempt: z.number(), at: z.string() });
export type StatusEvent = z.infer<typeof statusEventSchema>;
