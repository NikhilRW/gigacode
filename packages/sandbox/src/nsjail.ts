import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LANGUAGES, type LanguageId } from '@engine/shared';
import { RunCgroup, setupRunsCgroup } from './cgroup.ts';
import { captureCapped } from './output.ts';
import { renderNsjailConfig } from './nsjail-config.ts';
import { composeSeccompPolicy } from './seccomp.ts';
import { signalName } from './signals.ts';
import type { SandboxDriver, SandboxResult, SandboxSpec } from './types.ts';

export const PINNED_NSJAIL_VERSION = '3.4';

export interface NsjailDriverOptions {
  nsjailBin: string;
  rootfsDir: string;
  seccompDir: string;
  languages: LanguageId[];
  /** File written at image build time holding the nsjail release tag. */
  versionFile?: string;
}

/**
 * Runs each job under nsjail: new user/pid/mount/net/ipc/uts/cgroup namespaces, seccomp-bpf,
 * rlimits, read-only rootfs. The worker owns the per-run cgroup v2 (memory, pids, cpu) so it can
 * read OOM/peak/cpu stats and kill every descendant via cgroup.kill.
 */
export class NsjailDriver implements SandboxDriver {
  readonly name = 'nsjail';
  private runsCgroup: string | null = null;

  constructor(private readonly opts: NsjailDriverOptions) {}

  private async cgroupRoot(): Promise<string> {
    if (!this.runsCgroup) this.runsCgroup = await setupRunsCgroup();
    return this.runsCgroup;
  }

  async selfTest(): Promise<void> {
    await access(this.opts.nsjailBin, constants.X_OK).catch(() => {
      throw new Error(`nsjail binary not executable at ${this.opts.nsjailBin}`);
    });
    const version = (await readFile(this.opts.versionFile ?? '/usr/local/share/nsjail.version', 'utf8').catch(() => ''))
      .trim();
    if (version !== PINNED_NSJAIL_VERSION)
      throw new Error(`nsjail version ${version || 'unknown'} does not match pinned ${PINNED_NSJAIL_VERSION}`);
    await this.cgroupRoot();
    for (const lang of this.opts.languages) {
      await access(join(this.opts.rootfsDir, LANGUAGES[lang].rootfs, 'bin')).catch(() => {
        throw new Error(`rootfs missing for ${lang}`);
      });
    }
    await runProbes(this, this.opts.rootfsDir, this.opts.languages);
  }

  async run(spec: SandboxSpec, signal: AbortSignal): Promise<SandboxResult> {
    const started = Date.now();
    const control = await mkdtemp(join(tmpdir(), 'nsj-'));
    const logPath = join(control, 'nsjail.log');
    const policyPath = join(control, 'policy.kafel');
    const configPath = join(control, 'run.cfg');
    let cgroup: RunCgroup | null = null;
    const fail = (setupError: string): SandboxResult => ({
      ...emptyResult(spec),
      setupError,
      wallMs: Date.now() - started,
    });

    try {
      await writeFile(policyPath, await composeSeccompPolicy(this.opts.seccompDir, spec.language), { mode: 0o600 });
      await writeFile(configPath, renderNsjailConfig({ spec, seccompPolicyPath: policyPath, logPath }), { mode: 0o600 });
      cgroup = await RunCgroup.create(await this.cgroupRoot(), `run-${randomUUID()}`, {
        memoryBytes: spec.limits.memoryMb * 1024 * 1024,
        pids: spec.limits.pids,
        cpuMsPerSec: spec.limits.cpuMsPerSec,
      });
    } catch (err) {
      await cgroup?.destroy().catch(() => {});
      await rm(control, { recursive: true, force: true });
      return fail(`sandbox setup failed: ${(err as Error).message}`);
    }

    const stdin = await open(spec.stdinPath, 'r');
    let watchdogFired = false;
    let aborted = false;
    try {
      // The tiny sh wrapper only moves itself into the run cgroup and execs nsjail. Its script is a
      // constant; every argument is passed as argv, never interpolated into shell text.
      const child = spawn(
        '/bin/sh',
        ['-c', 'echo $$ > "$1" && shift && exec "$@"', 'sh', cgroup.procsFile, this.opts.nsjailBin, '--config', configPath],
        { stdio: [stdin.fd, 'pipe', 'pipe'], env: {}, detached: true },
      );

      const killTree = () => {
        void cgroup!.killAll();
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          // gone
        }
      };
      const watchdog = setTimeout(() => {
        watchdogFired = true;
        killTree();
      }, spec.limits.wallMs + 1000 + 500);
      const onAbort = () => {
        aborted = true;
        killTree();
      };
      if (signal.aborted) onAbort();
      signal.addEventListener('abort', onAbort, { once: true });

      const [out, err, exit] = await Promise.all([
        captureCapped(child.stdout!, spec.stdoutPath, spec.limits.outputBytes),
        captureCapped(child.stderr!, spec.stderrPath, spec.limits.outputBytes),
        new Promise<{ code: number | null; sig: NodeJS.Signals | null }>((resolve) =>
          child.on('exit', (code, sig) => resolve({ code, sig })),
        ),
      ]);
      clearTimeout(watchdog);
      signal.removeEventListener('abort', onAbort);

      const stats = await cgroup.stats();
      const log = await readFile(logPath, 'utf8').catch(() => '');
      const wallMs = Date.now() - started;

      if (!/Executing '/.test(log) && !aborted && !watchdogFired) {
        // nsjail never reached exec of the user program
        return { ...fail(`nsjail failed before exec: ${lastErrorLine(log)}`), wallMs };
      }

      const nsjailTimedOut = /run time >= time limit/.test(log);
      let exitCode: number | null = exit.code;
      let termSignal: string | null = exit.sig;
      // nsjail reports a signalled child as 128 + signal number
      if (exitCode !== null && exitCode > 128 && exitCode < 128 + 65) {
        termSignal = signalName(exitCode - 128);
        exitCode = null;
      }
      return {
        exitCode,
        termSignal,
        timedOut: nsjailTimedOut || watchdogFired,
        oomKilled: stats.oomKills > 0,
        killedBySeccomp: termSignal === 'SIGSYS' || /seccomp violation|SIGSYS/i.test(log),
        setupError: null,
        wallMs,
        cpuMs: stats.cpuMs,
        peakMemoryBytes: stats.peakMemoryBytes,
        stdoutPath: spec.stdoutPath,
        stderrPath: spec.stderrPath,
        stdoutBytes: out.bytes,
        stderrBytes: err.bytes,
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated,
      };
    } finally {
      await stdin.close();
      await cgroup.destroy().catch(() => {});
      await rm(control, { recursive: true, force: true });
    }
  }
}

function lastErrorLine(log: string): string {
  const lines = log.split('\n').filter((l) => /\[[EFW]\]/.test(l) && !l.includes('logParams'));
  if (lines.length === 0) return log.split('\n').filter(Boolean).pop()?.slice(0, 300) ?? 'no log';
  return lines
    .slice(-4)
    .map((l) => l.replace(/^\[\w\]\[[^\]]+\]\[\d+\] /, ''))
    .join(' | ')
    .slice(0, 800);
}

export function emptyResult(spec: SandboxSpec): SandboxResult {
  return {
    exitCode: null,
    termSignal: null,
    timedOut: false,
    oomKilled: false,
    killedBySeccomp: false,
    setupError: null,
    wallMs: 0,
    cpuMs: 0,
    peakMemoryBytes: 0,
    stdoutPath: spec.stdoutPath,
    stderrPath: spec.stderrPath,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Self-test probes: hello world per language, network egress must fail, fork bomb contained.

const PROBE_UID = 199_999;

async function probeRun(
  driver: SandboxDriver,
  rootfsDir: string,
  language: LanguageId,
  files: Record<string, string>,
  command: string[],
  wallMs = 5000,
): Promise<{ result: SandboxResult; stdout: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'probe-'));
  // traversable, not listable: nsjail binds the workspace from inside its user namespace
  await chmod(dir, 0o711);
  const ws = join(dir, 'workspace');
  await mkdir(ws);
  for (const [name, content] of Object.entries(files)) await writeFile(join(ws, name), content);
  await chmodTree(ws);
  await writeFile(join(dir, 'stdin'), '');
  try {
    const result = await driver.run(
      {
        language,
        rootfsPath: join(rootfsDir, LANGUAGES[language].rootfs),
        workspaceDir: ws,
        command,
        stdinPath: join(dir, 'stdin'),
        stdoutPath: join(dir, 'stdout'),
        stderrPath: join(dir, 'stderr'),
        limits: { wallMs, memoryMb: 512, cpuMsPerSec: 1000, pids: 64, fileSizeMb: 16, outputBytes: 65536, tmpfsMb: 64 },
        hostUid: PROBE_UID,
        network: false,
      },
      new AbortController().signal,
    );
    const stdout = await readFile(join(dir, 'stdout'), 'utf8').catch(() => '');
    return { result, stdout };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function chmodTree(ws: string) {
  // Probe workspaces are world-writable so the mapped probe uid can write compile output.
  await chmod(ws, 0o777);
}

export async function runProbes(driver: SandboxDriver, rootfsDir: string, languages: LanguageId[]): Promise<void> {
  for (const lang of languages) {
    const cfg = LANGUAGES[lang];
    const files = { [cfg.defaultEntryFile]: cfg.helloWorld };
    if (cfg.compile) {
      const c = await probeRun(driver, rootfsDir, lang, files, cfg.compile(cfg.defaultEntryFile), 10_000);
      if (c.result.exitCode !== 0)
        throw new Error(`self-test: ${lang} compile failed (${describe(c.result)})`);
      // compile output lives in a throwaway workspace; compile + run in one workspace is tested by the worker path
      continue;
    }
    const { result, stdout } = await probeRun(driver, rootfsDir, lang, files, cfg.run(cfg.defaultEntryFile));
    if (result.exitCode !== 0 || stdout.trim() !== 'hello')
      throw new Error(`self-test: ${lang} hello world failed (${describe(result)}, stdout=${JSON.stringify(stdout.slice(0, 100))})`);
  }

  const net = await probeRun(
    driver,
    rootfsDir,
    'python',
    {
      'net.py':
        'import socket\ntry:\n    socket.create_connection(("1.1.1.1", 53), timeout=2)\n    print("CONNECTED")\nexcept OSError as e:\n    print("blocked")\n',
    },
    ['/usr/local/bin/python3', '-I', 'net.py'],
  );
  if (net.stdout.includes('CONNECTED')) throw new Error('self-test: network egress from sandbox succeeded');

  const bomb = await probeRun(
    driver,
    rootfsDir,
    'python',
    {
      'bomb.py':
        'import os\nn = 0\nwhile True:\n    try:\n        os.fork()\n        n += 1\n    except OSError:\n        pass\n',
    },
    ['/usr/local/bin/python3', '-I', 'bomb.py'],
    2000,
  );
  if (bomb.result.setupError || bomb.result.wallMs > 2000 + 3000)
    throw new Error(`self-test: fork bomb not contained (${describe(bomb.result)})`);
}

function describe(r: SandboxResult): string {
  return `exit=${r.exitCode} signal=${r.termSignal} timeout=${r.timedOut} setup=${r.setupError ?? '-'}`;
}
