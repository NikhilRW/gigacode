import type {
  AdminTenant,
  ApiKey,
  Execution,
  ExecutionAttempt,
  ExecutionEvent,
  ExecutionStatus,
  LanguageId,
  Limits,
  TenantLimits,
} from '@engine/shared';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export interface ExecutionRow {
  id: string;
  tenant_id: string;
  language: string;
  entry_file: string;
  status: string;
  priority: number;
  limits: Limits;
  artifact_prefix: string;
  attempt: number;
  max_attempts: number;
  cancel_requested: boolean;
  exit_code: number | null;
  term_signal: string | null;
  failure_reason: string | null;
  wall_ms: number | null;
  cpu_ms: number | null;
  peak_memory_bytes: number | null;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  created_at: Date;
  queued_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  request_hash: string;
  idempotency_key: string | null;
}

export function toExecution(r: ExecutionRow): Execution {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    language: r.language as LanguageId,
    entryFile: r.entry_file,
    status: r.status as ExecutionStatus,
    priority: r.priority,
    limits: r.limits,
    attempt: r.attempt,
    maxAttempts: r.max_attempts,
    cancelRequested: r.cancel_requested,
    exitCode: r.exit_code,
    termSignal: r.term_signal,
    failureReason: r.failure_reason,
    wallMs: r.wall_ms,
    cpuMs: r.cpu_ms,
    peakMemoryBytes: r.peak_memory_bytes,
    stdoutTruncated: r.stdout_truncated,
    stderrTruncated: r.stderr_truncated,
    createdAt: r.created_at.toISOString(),
    queuedAt: iso(r.queued_at),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
  };
}

export function toEvent(r: {
  id: number;
  attempt: number;
  from_status: string | null;
  to_status: string;
  at: Date;
  detail: Record<string, unknown> | null;
}): ExecutionEvent {
  return {
    id: r.id,
    attempt: r.attempt,
    fromStatus: r.from_status as ExecutionStatus | null,
    toStatus: r.to_status as ExecutionStatus,
    at: r.at.toISOString(),
    detail: r.detail,
  };
}

export function toAttempt(r: {
  attempt: number;
  worker_id: string;
  started_at: Date;
  finished_at: Date | null;
  outcome: string | null;
  exit_code: number | null;
}): ExecutionAttempt {
  return {
    attempt: r.attempt,
    workerId: r.worker_id,
    startedAt: r.started_at.toISOString(),
    finishedAt: iso(r.finished_at),
    outcome: r.outcome,
    exitCode: r.exit_code,
  };
}

export function toApiKey(r: {
  id: string;
  name: string;
  prefix: string;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}): ApiKey {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    lastUsedAt: iso(r.last_used_at),
    revokedAt: iso(r.revoked_at),
    createdAt: r.created_at.toISOString(),
  };
}

export interface TenantRow {
  id: string;
  name: string;
  created_at: Date;
  max_concurrent: number;
  max_exec_per_min: number;
  max_timeout_ms: number;
  max_memory_mb: number;
  max_source_bytes: number;
}

export function toTenantLimits(r: TenantRow): TenantLimits {
  return {
    maxConcurrent: r.max_concurrent,
    maxExecPerMin: r.max_exec_per_min,
    maxTimeoutMs: r.max_timeout_ms,
    maxMemoryMb: r.max_memory_mb,
    maxSourceBytes: r.max_source_bytes,
  };
}

export function toAdminTenant(r: TenantRow): AdminTenant {
  return { id: r.id, name: r.name, createdAt: r.created_at.toISOString(), ...toTenantLimits(r) };
}
