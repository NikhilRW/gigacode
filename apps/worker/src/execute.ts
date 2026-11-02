import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { COMPILE_LIMITS, DEFAULTS, LANGUAGES, type ResultFile } from '@engine/shared';
import type { ClaimedJob } from '@engine/db';
import type { SandboxDriver, SandboxLimits, SandboxResult } from '@engine/sandbox';
import { mapOutcome, type AbortReason, type Outcome } from './result-mapping.ts';
import type { RunDir } from './run-dir.ts';

export interface ExecutionOutput {
  outcome: Outcome;
  result: SandboxResult;
  compile: ResultFile['compile'];
}

/** Compile (when the language needs it) and run the job inside the sandbox. */
export async function executeInSandbox(args: {
  driver: SandboxDriver;
  job: ClaimedJob;
  dir: RunDir;
  rootfsDir: string;
  hostUid: number;
  signal: AbortSignal;
  abortReason: () => AbortReason | null;
}): Promise<ExecutionOutput> {
  const { driver, job, dir, signal } = args;
  const lang = LANGUAGES[job.language];
  const base = {
    language: job.language,
    rootfsPath: join(args.rootfsDir, lang.rootfs),
    workspaceDir: dir.workspace,
    hostUid: args.hostUid,
    network: dir.manifest.network === true,
  };
  const runLimits: SandboxLimits = {
    wallMs: job.limits.timeoutMs,
    memoryMb: job.limits.memoryMb,
    cpuMsPerSec: job.limits.cpuMsPerSec,
    pids: job.limits.pids,
    fileSizeMb: DEFAULTS.fileSizeMb,
    outputBytes: DEFAULTS.outputBytes,
    tmpfsMb: DEFAULTS.tmpfsMb,
  };

  let compile: ResultFile['compile'] = null;
  if (lang.compile) {
    const c = await driver.run(
      {
        ...base,
        network: false, // Compilation never needs outbound access.
        command: lang.compile(job.entryFile),
        stdinPath: '/dev/null',
        stdoutPath: join(dir.root, 'stdout.log'),
        stderrPath: join(dir.root, 'stderr.log'),
        limits: { ...runLimits, wallMs: COMPILE_LIMITS.wallMs, memoryMb: COMPILE_LIMITS.memoryMb },
      },
      signal,
    );
    await recordSetupError(c);
    compile = { exitCode: c.exitCode, wallMs: c.wallMs };
    if (c.exitCode !== 0 || c.setupError || c.timedOut || args.abortReason()) {
      // Compiler output becomes the job's stdout/stderr. A compile timeout is still a compile error.
      const outcome = mapOutcome({ ...c, timedOut: false }, { aborted: args.abortReason(), compileFailed: true });
      return { outcome, result: c, compile };
    }
  }

  const r = await driver.run(
    {
      ...base,
      command: lang.run(job.entryFile),
      stdinPath: dir.stdinPath,
      stdoutPath: join(dir.root, 'stdout.log'),
      stderrPath: join(dir.root, 'stderr.log'),
      limits: runLimits,
    },
    signal,
  );
  await recordSetupError(r);
  return { outcome: mapOutcome(r, { aborted: args.abortReason(), compileFailed: false }), result: r, compile };
}

async function recordSetupError(result: SandboxResult) {
  if (!result.setupError) return;
  const text = `Sandbox setup failed: ${result.setupError}\n`;
  await writeFile(result.stderrPath, text);
  result.stderrBytes = Buffer.byteLength(text);
}
