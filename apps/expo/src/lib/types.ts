// Wire DTOs for the existing /v1 API. No server code is bundled into the app.
export type Language = 'python' | 'node' | 'c' | 'cpp';
export type Status =
  | 'CREATED'
  | 'QUEUED'
  | 'DISPATCHED'
  | 'STARTING'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'DEAD_LETTERED';
export const statuses: Status[] = [
  'CREATED',
  'QUEUED',
  'DISPATCHED',
  'STARTING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'TIMEOUT',
  'CANCELLED',
  'DEAD_LETTERED',
];
export const terminal = (status: Status) =>
  ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'DEAD_LETTERED'].includes(status);
export interface TenantLimits {
  maxConcurrent: number;
  maxExecPerMin: number;
  maxTimeoutMs: number;
  maxMemoryMb: number;
  maxSourceBytes: number;
}
export interface Me {
  user: { id: string; email: string; name: string | null; role: 'owner' | 'member' | 'platform_admin' };
  tenant: { id: string; name: string };
  limits: TenantLimits;
}
export interface NativeSession extends Me {
  token: string;
  expiresIn: number;
}
export interface Limits {
  timeoutMs: number;
  memoryMb: number;
  cpuMsPerSec?: number;
  pids?: number;
}
export interface Source {
  language: Language;
  entryFile: string;
  files: { path: string; content: string }[];
  stdin: string;
  limits: Limits;
  network?: boolean;
}
export interface Execution {
  id: string;
  tenantId: string;
  language: Language;
  entryFile: string;
  status: Status;
  attempt: number;
  maxAttempts: number;
  cancelRequested: boolean;
  exitCode: number | null;
  termSignal: string | null;
  failureReason: string | null;
  wallMs: number | null;
  cpuMs: number | null;
  peakMemoryBytes: number | null;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  createdAt: string;
  limits: Limits;
}
export interface ExecutionDetail extends Execution {
  network?: boolean;
  stale?: boolean;
  files: { path: string; bytes: number }[];
  events: {
    id: number;
    attempt: number;
    fromStatus: Status | null;
    toStatus: Status;
    at: string;
    detail: Record<string, unknown> | null;
  }[];
  attempts: {
    attempt: number;
    workerId: string;
    startedAt: string;
    finishedAt: string | null;
    outcome: string | null;
    exitCode: number | null;
  }[];
}
export interface ExecutionList {
  items: Execution[];
  nextCursor: string | null;
}
export interface Result {
  network?: boolean;
  status: Status;
  exitCode: number | null;
  termSignal: string | null;
  failureReason: string | null;
  wallMs: number;
  cpuMs: number;
  peakMemoryBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  compile: { exitCode: number | null; wallMs: number } | null;
}
export interface Usage {
  executionsToday: number;
  running: number;
  queued: number;
  totalCpuMs: number;
  successRate24h: number | null;
  limits: TenantLimits;
}
export interface Timeseries {
  hours: number;
  points: {
    at: string;
    success: number;
    failed: number;
    timeout: number;
    cancelled: number;
    other: number;
  }[];
}
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
export interface Worker {
  id: string;
  hostname: string;
  version: string;
  slots: number;
  busy: number | null;
  status: string;
  alive: boolean;
  lastHeartbeatAt: string;
}
export interface Queue {
  depth: number;
  oldestAgeSeconds: number;
  byTenant: { tenantId: string; tenantName: string; queued: number; running: number }[];
}
export interface AdminTenant extends TenantLimits {
  id: string;
  name: string;
  createdAt: string;
}
