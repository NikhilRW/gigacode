import { describe, expect, it } from 'vitest';
import type { SandboxResult } from '@engine/sandbox';
import { mapOutcome } from '../src/result-mapping.ts';

const base: SandboxResult = {
  exitCode: 0,
  termSignal: null,
  timedOut: false,
  oomKilled: false,
  killedBySeccomp: false,
  setupError: null,
  wallMs: 10,
  cpuMs: 5,
  peakMemoryBytes: 1,
  stdoutPath: '',
  stderrPath: '',
  stdoutBytes: 0,
  stderrBytes: 0,
  stdoutTruncated: false,
  stderrTruncated: false,
};
const none = { aborted: null, compileFailed: false };

describe('mapOutcome', () => {
  it('exit 0 is SUCCESS', () => expect(mapOutcome(base, none)).toEqual({ status: 'SUCCESS', failureReason: null }));
  it('non-zero exit is runtime_error', () =>
    expect(mapOutcome({ ...base, exitCode: 1 }, none)).toEqual({ status: 'FAILED', failureReason: 'runtime_error' }));
  it('timeout wins over signal', () =>
    expect(mapOutcome({ ...base, exitCode: null, termSignal: 'SIGKILL', timedOut: true }, none).status).toBe('TIMEOUT'));
  it('oom', () =>
    expect(mapOutcome({ ...base, exitCode: null, termSignal: 'SIGKILL', oomKilled: true }, none).failureReason).toBe('oom'));
  it('seccomp', () =>
    expect(mapOutcome({ ...base, exitCode: null, termSignal: 'SIGSYS', killedBySeccomp: true }, none).failureReason).toBe(
      'seccomp_violation',
    ));
  it('signal', () =>
    expect(mapOutcome({ ...base, exitCode: null, termSignal: 'SIGSEGV' }, none).failureReason).toBe('killed_by_signal'));
  it('compile error', () =>
    expect(mapOutcome({ ...base, exitCode: 1 }, { aborted: null, compileFailed: true }).failureReason).toBe('compile_error'));
  it('setup error', () =>
    expect(mapOutcome({ ...base, setupError: 'x' }, none).failureReason).toBe('sandbox_setup_error'));
  it('cancel wins over everything', () =>
    expect(mapOutcome({ ...base, timedOut: true }, { aborted: 'cancel', compileFailed: false }).status).toBe('CANCELLED'));
});
