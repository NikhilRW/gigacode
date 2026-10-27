export const EXECUTION_STATES = [
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
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATES)[number];

export const TERMINAL_STATES: readonly ExecutionStatus[] = ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'DEAD_LETTERED'];

/** States in which a worker holds a lease and a tenant concurrency slot. */
export const ACTIVE_STATES: readonly ExecutionStatus[] = ['DISPATCHED', 'STARTING', 'RUNNING'];

const TRANSITIONS: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  CREATED: ['QUEUED', 'FAILED'],
  QUEUED: ['DISPATCHED', 'CANCELLED', 'DEAD_LETTERED'],
  // DEAD_LETTERED from an active state happens when a lease expires on the last attempt.
  DISPATCHED: ['STARTING', 'QUEUED', 'CANCELLED', 'DEAD_LETTERED'],
  STARTING: ['RUNNING', 'FAILED', 'QUEUED', 'CANCELLED', 'DEAD_LETTERED'],
  RUNNING: ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'QUEUED', 'DEAD_LETTERED'],
  SUCCESS: [],
  FAILED: [],
  TIMEOUT: [],
  CANCELLED: [],
  // Admin requeue is the only way out of the dead-letter state.
  DEAD_LETTERED: ['QUEUED'],
};

export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ExecutionStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

export function isActive(status: ExecutionStatus): boolean {
  return ACTIVE_STATES.includes(status);
}

export const FAILURE_REASONS = [
  'runtime_error',
  'oom',
  'killed_by_signal',
  'seccomp_violation',
  'compile_error',
  'sandbox_setup_error',
  'artifact_upload_failed',
  'artifact_missing',
  'lease_expired',
  'max_attempts_exceeded',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];
