/**
 * Sandbox abuse suite. Requires Linux with nsjail + delegated cgroup v2 (run inside the worker
 * container: `docker compose exec worker pnpm test:sandbox`). Skipped elsewhere, loudly.
 */
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile, chown, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LANGUAGES, type LanguageId } from '@engine/shared';
import { NsjailDriver, type SandboxResult } from '../../src/index.ts';

const NSJAIL = process.env.NSJAIL_BIN ?? '/usr/local/bin/nsjail';
const ROOTFS = process.env.SANDBOX_ROOTFS_DIR ?? '/opt/sandbox/rootfs';
const available = process.platform === 'linux' && existsSync(NSJAIL) && existsSync(ROOTFS);
if (!available) console.warn('\n*** SANDBOX ABUSE SUITE SKIPPED: needs Linux with nsjail and rootfs ***\n');

const seccompDir = resolve(fileURLToPath(new URL('../../../../infra/nsjail/seccomp', import.meta.url)));
const driver = new NsjailDriver({ nsjailBin: NSJAIL, rootfsDir: ROOTFS, seccompDir, languages: ['python', 'c'] });
const UID = 210_000;

interface Run {
  result: SandboxResult;
  stdout: string;
  stderr: string;
}

async function runIn(language: LanguageId, files: Record<string, string>, opts: { wallMs?: number; memoryMb?: number; command?: string[] } = {}): Promise<Run> {
  const dir = await mkdtemp(join(tmpdir(), 'abuse-'));
  await chmod(dir, 0o711);
  const ws = join(dir, 'workspace');
  await mkdir(ws);
  for (const [n, c] of Object.entries(files)) await writeFile(join(ws, n), c);
  await chown(ws, UID, UID);
  for (const n of Object.keys(files)) await chown(join(ws, n), UID, UID);
  await writeFile(join(dir, 'stdin'), '');
  const cfg = LANGUAGES[language];
  const limits = {
    wallMs: opts.wallMs ?? 3000,
    memoryMb: opts.memoryMb ?? 128,
    cpuMsPerSec: 1000,
    pids: 64,
    fileSizeMb: 16,
    outputBytes: 1024 * 1024,
    tmpfsMb: 32,
  };
  const spec = (command: string[], wallMs = limits.wallMs) => ({
    language,
    rootfsPath: join(ROOTFS, cfg.rootfs),
    workspaceDir: ws,
    command,
    stdinPath: join(dir, 'stdin'),
    stdoutPath: join(dir, 'stdout'),
    stderrPath: join(dir, 'stderr'),
    limits: { ...limits, wallMs },
    hostUid: UID,
    network: false as const,
  });
  try {
    const entry = Object.keys(files)[0]!;
    if (cfg.compile && !opts.command) {
      const c = await driver.run(spec(cfg.compile(entry), 10_000), new AbortController().signal);
      if (c.exitCode !== 0) throw new Error(`compile failed: ${await readFile(join(dir, 'stderr'), 'utf8')}`);
    }
    const result = await driver.run(spec(opts.command ?? cfg.run(entry)), new AbortController().signal);
    return {
      result,
      stdout: await readFile(join(dir, 'stdout'), 'utf8').catch(() => ''),
      stderr: await readFile(join(dir, 'stderr'), 'utf8').catch(() => ''),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const py = (code: string, opts?: Parameters<typeof runIn>[2]) => runIn('python', { 'main.py': code }, opts);
const c = (code: string, opts?: Parameters<typeof runIn>[2]) => runIn('c', { 'main.c': code }, opts);

describe.skipIf(!available)('sandbox abuse suite', () => {
  let cgroupsBefore: string[] = [];
  beforeAll(async () => {
    await driver.selfTest();
    cgroupsBefore = await listRunCgroups();
  }, 120_000);
  afterAll(async () => {
    // worker left clean: no leftover run cgroups
    expect(await listRunCgroups()).toEqual(cgroupsBefore);
  });

  it('hello world (python, c)', async () => {
    expect((await py('print("hi")')).stdout).toBe('hi\n');
    const r = await c('#include <stdio.h>\nint main(){printf("hi\\n");return 0;}');
    expect(r.stdout).toBe('hi\n');
  }, 30_000);

  it('infinite loop -> timeout', async () => {
    const r = await py('while True: pass', { wallMs: 1500 });
    expect(r.result.timedOut).toBe(true);
    expect(r.result.wallMs).toBeLessThan(1500 + 2500);
  }, 20_000);

  it('memory bomb -> oom', async () => {
    const r = await py('x = []\nwhile True: x.append(bytearray(1 << 20))', { memoryMb: 64 });
    expect(r.result.oomKilled).toBe(true);
    expect(process.memoryUsage().rss).toBeLessThan(1024 * 1024 * 1024);
  }, 20_000);

  it('fork bomb -> contained by pids limit', async () => {
    const r = await c('#include <unistd.h>\nint main(){for(;;) fork();}', { wallMs: 2000 });
    expect(r.result.setupError).toBeNull();
    expect(r.result.wallMs).toBeLessThan(2000 + 3000);
  }, 30_000);

  it('network: external, host, metadata all fail', async () => {
    const r = await py(
      [
        'import socket',
        'for host, port in [("1.1.1.1", 53), ("127.0.0.1", 5432), ("169.254.169.254", 80)]:',
        '    try:',
        '        socket.create_connection((host, port), timeout=1)',
        '        print("OPEN", host)',
        '    except OSError:',
        '        print("blocked", host)',
      ].join('\n'),
    );
    expect(r.stdout).not.toContain('OPEN');
    expect(r.stdout.match(/blocked/g)?.length).toBe(3);
  }, 20_000);

  it('host files are not visible', async () => {
    const r = await py(
      [
        'import os',
        'for p in ["/etc/shadow", "/proc/1/environ", "/var/lib/worker/runs", "/opt/sandbox", "/app", "/root"]:',
        '    try:',
        '        data = open(p, "rb").read() if not os.path.isdir(p) else os.listdir(p)',
        '        print("READ", p, len(data))',
        '    except OSError:',
        '        print("denied", p)',
      ].join('\n'),
    );
    // /etc/shadow exists in the runtime image but is root-only; /proc/1 is the sandbox's own init.
    expect(r.stdout).not.toMatch(/READ \/etc\/shadow/);
    expect(r.stdout).not.toMatch(/READ \/var\/lib\/worker/);
    expect(r.stdout).not.toMatch(/READ \/app/);
    expect(r.stdout).not.toMatch(/READ \/opt\/sandbox/);
  }, 20_000);

  it('rootfs is read-only', async () => {
    const r = await py('open("/usr/local/bin/evil", "w").write("x")');
    expect(r.result.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/Read-only file system|Permission denied/);
  }, 20_000);

  it.each(['mount', 'ptrace', 'unshare', 'keyctl', 'bpf'])('forbidden syscall %s -> seccomp kill', async (name) => {
    const calls: Record<string, string> = {
      mount: 'syscall(SYS_mount, "none", "/tmp", "tmpfs", 0, 0);',
      ptrace: 'syscall(SYS_ptrace, 0, 0, 0, 0);',
      unshare: 'syscall(SYS_unshare, 0x10000000);',
      keyctl: 'syscall(SYS_keyctl, 0, 0, 0, 0, 0);',
      bpf: 'syscall(SYS_bpf, 0, 0, 0);',
    };
    const r = await c(`#define _GNU_SOURCE\n#include <unistd.h>\n#include <sys/syscall.h>\nint main(){${calls[name]}return 0;}`);
    expect(r.result.killedBySeccomp).toBe(true);
  }, 30_000);

  it('stdout flood -> truncated at cap, job finishes', async () => {
    const r = await py('import sys\nb = b"x" * 65536\nfor _ in range(16384): sys.stdout.buffer.write(b)', { wallMs: 8000 });
    expect(r.result.stdoutTruncated).toBe(true);
    expect(r.result.stdoutBytes).toBe(1024 * 1024);
  }, 30_000);

  it('very large file write -> blocked by size limits', async () => {
    const r = await py('f = open("/workspace/big", "wb")\nwhile True: f.write(b"x" * (1 << 20))');
    expect(r.result.exitCode === 0).toBe(false);
    const t = await py('f = open("/tmp/big", "wb")\nwhile True: f.write(b"x" * (1 << 20))');
    expect(t.result.exitCode === 0).toBe(false);
  }, 30_000);

  it('many open files, deep recursion, zombie children -> contained', async () => {
    const files = await py('fs = []\nwhile True: fs.append(open("/dev/null"))');
    expect(files.result.exitCode).not.toBe(0);
    expect(files.stderr).toMatch(/Too many open files/);
    const rec = await c('int f(int n){volatile char b[4096]; b[0]=n; return f(n+1)+b[0];}\nint main(){return f(0);}');
    expect(rec.result.termSignal).toBe('SIGSEGV');
    const zombies = await c('#include <unistd.h>\nint main(){for(int i=0;i<30;i++) if(fork()==0) _exit(0); sleep(1); return 0;}');
    expect(zombies.result.exitCode).toBe(0);
  }, 60_000);
});

async function listRunCgroups(): Promise<string[]> {
  const self = (await readFile('/proc/self/cgroup', 'utf8')).split('\n').find((l) => l.startsWith('0::'))!.slice(3).trim();
  const base = join('/sys/fs/cgroup', self.replace(/\/agent$/, ''), 'runs');
  return (await readdir(base).catch(() => [])).filter((n) => n.startsWith('run-'));
}
