import type { LanguageId } from '@engine/shared';

export interface SandboxLimits {
  wallMs: number;
  memoryMb: number;
  cpuMsPerSec: number;
  pids: number;
  fileSizeMb: number;
  outputBytes: number;
  tmpfsMb: number;
}

export interface SandboxSpec {
  language: LanguageId;
  /** Host path of the read-only rootfs for this language. */
  rootfsPath: string;
  /** Host path of the per-run workspace, mounted at /workspace. */
  workspaceDir: string;
  /** argv; argv[0] is an absolute path inside the rootfs or relative to /workspace. */
  command: string[];
  /** Host path of the stdin file. */
  stdinPath: string;
  /** Host paths where capped stdout/stderr are written. */
  stdoutPath: string;
  stderrPath: string;
  limits: SandboxLimits;
  /**
   * Host uid/gid the sandbox user (65534 inside) maps to. Each worker slot uses its own id so
   * concurrent runs never share a kernel uid (rlimits, signals, file ownership).
   */
  hostUid: number;
  /** Always false. Present so the contract is explicit. */
  network: false;
}

export interface SandboxResult {
  exitCode: number | null;
  termSignal: string | null;
  timedOut: boolean;
  oomKilled: boolean;
  killedBySeccomp: boolean;
  /** Sandbox could not be set up (bad config, missing rootfs): not the user's fault. */
  setupError: string | null;
  wallMs: number;
  cpuMs: number;
  peakMemoryBytes: number;
  stdoutPath: string;
  stderrPath: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface SandboxDriver {
  readonly name: string;
  /** Throws if the environment cannot provide the required isolation. */
  selfTest(): Promise<void>;
  run(spec: SandboxSpec, signal: AbortSignal): Promise<SandboxResult>;
}
