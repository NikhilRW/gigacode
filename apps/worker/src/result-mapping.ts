import type { Completion } from '@engine/db';
import type { SandboxResult } from '@engine/sandbox';

export type AbortReason = 'cancel' | 'lease_lost' | 'shutdown';

export interface Outcome {
  status: Completion['status'];
  failureReason: string | null;
}

/** Map a sandbox result to a terminal status. Order matters: the most specific cause wins. */
export function mapOutcome(r: SandboxResult, opts: { aborted: AbortReason | null; compileFailed: boolean }): Outcome {
  if (opts.aborted === 'cancel') return { status: 'CANCELLED', failureReason: null };
  if (r.setupError) return { status: 'FAILED', failureReason: 'sandbox_setup_error' };
  if (r.timedOut) return { status: 'TIMEOUT', failureReason: null };
  if (r.oomKilled) return { status: 'FAILED', failureReason: 'oom' };
  if (r.killedBySeccomp) return { status: 'FAILED', failureReason: 'seccomp_violation' };
  if (opts.compileFailed) return { status: 'FAILED', failureReason: 'compile_error' };
  if (r.exitCode === 0) return { status: 'SUCCESS', failureReason: null };
  if (r.termSignal) return { status: 'FAILED', failureReason: 'killed_by_signal' };
  return { status: 'FAILED', failureReason: 'runtime_error' };
}
