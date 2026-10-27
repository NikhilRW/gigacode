import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { LANGUAGES, type LanguageId } from '@engine/shared';
import { captureCapped } from './output.ts';
import { runProbes } from './nsjail.ts';
import type { SandboxDriver, SandboxResult, SandboxSpec } from './types.ts';

const IMAGES: Record<string, string> = { python: 'python:3.12-slim', node: 'node:20-slim', gcc: 'gcc:13' };

export interface DockerDriverOptions {
  seccompProfile: string;
  languages: LanguageId[];
}

/**
 * DEV ONLY fallback for machines without nsjail/cgroup v2 delegation (e.g. macOS).
 * Requires the docker socket in the worker and gives weaker isolation than NsjailDriver.
 * Refuses to construct when NODE_ENV=production.
 */
export class DockerDriver implements SandboxDriver {
  readonly name = 'docker';

  constructor(private readonly opts: DockerDriverOptions) {
    if (process.env.NODE_ENV === 'production') throw new Error('DockerDriver is not allowed in production');
  }

  async selfTest(): Promise<void> {
    await runProbes(this, '', this.opts.languages);
  }

  async run(spec: SandboxSpec, signal: AbortSignal): Promise<SandboxResult> {
    const started = Date.now();
    const name = `sbx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const image = IMAGES[LANGUAGES[spec.language].rootfs]!;
    const l = spec.limits;
    const args = [
      'run', '--rm', '-i', '--name', name,
      '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--security-opt', `seccomp=${this.opts.seccompProfile}`,
      '--memory', `${l.memoryMb}m`, '--memory-swap', `${l.memoryMb}m`,
      '--pids-limit', String(l.pids), '--cpus', String(l.cpuMsPerSec / 1000),
      '--ulimit', `fsize=${l.fileSizeMb * 1024 * 1024}`, '--ulimit', 'core=0', '--ulimit', 'nofile=256:256',
      '--user', '65534:65534',
      '--tmpfs', `/tmp:size=${l.tmpfsMb}m,mode=1777`,
      '-v', `${spec.workspaceDir}:/workspace:rw`, '-w', '/workspace',
      '--env', 'HOME=/tmp',
      image, ...spec.command,
    ];
    const stdin = await open(spec.stdinPath, 'r');
    let timedOut = false;
    try {
      const child = spawn('docker', args, { stdio: [stdin.fd, 'pipe', 'pipe'] });
      const kill = () => spawn('docker', ['kill', name], { stdio: 'ignore' });
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, l.wallMs);
      signal.addEventListener('abort', kill, { once: true });
      const [out, err, code] = await Promise.all([
        captureCapped(child.stdout!, spec.stdoutPath, l.outputBytes),
        captureCapped(child.stderr!, spec.stderrPath, l.outputBytes),
        new Promise<number | null>((resolve) => child.on('exit', (c) => resolve(c))),
      ]);
      clearTimeout(timer);
      const exitCode = code !== null && code > 128 ? null : code;
      const termSignal = code === 137 ? 'SIGKILL' : code === 159 ? 'SIGSYS' : null;
      return {
        exitCode,
        termSignal,
        timedOut,
        // docker reports OOM via inspect; the container is already removed (--rm), so infer it
        oomKilled: code === 137 && !timedOut,
        killedBySeccomp: code === 159,
        setupError: code === 125 ? 'docker run failed' : null,
        wallMs: Date.now() - started,
        cpuMs: 0,
        peakMemoryBytes: 0,
        stdoutPath: spec.stdoutPath,
        stderrPath: spec.stderrPath,
        stdoutBytes: out.bytes,
        stderrBytes: err.bytes,
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated,
      };
    } finally {
      await stdin.close();
    }
  }
}

export const defaultDockerSeccompProfile = (repoRoot: string) => join(repoRoot, 'infra/docker/seccomp-dev.json');
