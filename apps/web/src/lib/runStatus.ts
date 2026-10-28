import type { ExecutionDetail, ExecutionStatus } from '@engine/shared';
import { isTerminal } from '@shared/states.ts';
import { formatMs } from './format.ts';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const STATUS_LABEL: Record<ExecutionStatus, string> = {
  CREATED: 'Created',
  QUEUED: 'Queued',
  DISPATCHED: 'Assigned',
  STARTING: 'Starting',
  RUNNING: 'Running',
  SUCCESS: 'Succeeded',
  FAILED: 'Failed',
  TIMEOUT: 'Timed out',
  CANCELLED: 'Cancelled',
  DEAD_LETTERED: 'Gave up',
};

export const STATUS_TONE: Record<ExecutionStatus, Tone> = {
  CREATED: 'neutral',
  QUEUED: 'neutral',
  DISPATCHED: 'info',
  STARTING: 'info',
  RUNNING: 'info',
  SUCCESS: 'success',
  FAILED: 'danger',
  TIMEOUT: 'warning',
  CANCELLED: 'neutral',
  DEAD_LETTERED: 'danger',
};

/** The four steps shown while a run progresses. */
export const PROGRESS_STEPS = ['Queued', 'Starting', 'Running', 'Done'] as const;

/** Index (0-3) of the step a status belongs to. Terminal statuses are the last step. */
export function progressIndex(status: ExecutionStatus): number {
  if (isTerminal(status)) return 3;
  if (status === 'RUNNING') return 2;
  if (status === 'DISPATCHED' || status === 'STARTING') return 1;
  return 0;
}

export interface Explanation {
  tone: Tone;
  title: string;
  detail: string;
  /** What the user can do next, when there is something useful to do. */
  action?: string;
}

/** Plain-language explanation of how a run ended. Returns null for a clean success. */
export function explainOutcome(e: ExecutionDetail): Explanation | null {
  switch (e.status) {
    case 'SUCCESS':
      return null;
    case 'TIMEOUT':
      return {
        tone: 'warning',
        title: `Timed out after ${formatMs(e.limits.timeoutMs)}`,
        detail: 'The program was still running when its time limit was reached, so it was stopped.',
        action: 'Raise the time limit under Limits, or check for an infinite loop.',
      };
    case 'CANCELLED':
      return { tone: 'neutral', title: 'Cancelled', detail: 'This run was stopped before it finished.' };
    case 'DEAD_LETTERED':
      return {
        tone: 'danger',
        title: 'Could not be completed',
        detail: `The platform tried ${e.attempt} time${e.attempt === 1 ? '' : 's'} but workers kept failing, so it gave up. This is not caused by your code.`,
        action: 'Try again. If it keeps happening, contact an administrator.',
      };
    case 'FAILED':
      break;
    default:
      return null;
  }
  switch (e.failureReason) {
    case 'compile_error':
      return {
        tone: 'danger',
        title: 'Compile error',
        detail: 'The compiler could not build your program.',
        action: 'Open the stderr tab to see the compiler messages.',
      };
    case 'oom':
      return {
        tone: 'danger',
        title: `Ran out of memory (${e.limits.memoryMb} MB limit)`,
        detail: 'The program tried to use more memory than it is allowed and was stopped.',
        action: 'Use less memory, or raise the memory limit under Limits.',
      };
    case 'seccomp_violation':
      return {
        tone: 'danger',
        title: 'Blocked operation',
        detail: 'The program tried a system operation the sandbox does not allow (for example opening network connections) and was stopped.',
        action: 'Remove the operation. Network access is never available.',
      };
    case 'killed_by_signal':
      return {
        tone: 'danger',
        title: `Crashed (${e.termSignal ?? 'signal'})`,
        detail: 'The program was stopped by the operating system, usually because of a crash such as an invalid memory access.',
        action: 'Check array bounds and pointers. The stderr tab may have more details.',
      };
    case 'sandbox_setup_error':
      return {
        tone: 'danger',
        title: 'The sandbox could not start',
        detail: 'This is a platform problem, not an error in your code.',
        action: 'Run it again.',
      };
    case 'artifact_upload_failed':
    case 'artifact_missing':
      return {
        tone: 'danger',
        title: 'Your files could not be stored',
        detail: 'The platform could not save the submitted files, so nothing was run.',
        action: 'Run it again.',
      };
    default:
      return {
        tone: 'danger',
        title: e.exitCode !== null ? `Exited with code ${e.exitCode}` : 'Failed',
        detail: 'The program finished with an error.',
        action: 'Open the stderr tab to see its error output.',
      };
  }
}

/** Plain-language label for an attempt outcome or event, used on the run timeline. */
export function describeEvent(toStatus: ExecutionStatus, fromStatus: ExecutionStatus | null, reason?: unknown): string {
  if (toStatus === 'QUEUED' && fromStatus && fromStatus !== 'CREATED') {
    return reason === 'lease_expired' ? 'Worker was lost; queued again automatically' : 'Queued again';
  }
  switch (toStatus) {
    case 'CREATED':
      return 'Run submitted';
    case 'QUEUED':
      return 'Waiting for a worker';
    case 'DISPATCHED':
      return 'Picked up by a worker';
    case 'STARTING':
      return 'Preparing the sandbox';
    case 'RUNNING':
      return 'Program started';
    case 'SUCCESS':
      return 'Finished successfully';
    case 'FAILED':
      return 'Finished with an error';
    case 'TIMEOUT':
      return 'Stopped: time limit reached';
    case 'CANCELLED':
      return 'Cancelled';
    case 'DEAD_LETTERED':
      return 'Gave up after repeated worker failures';
  }
}
