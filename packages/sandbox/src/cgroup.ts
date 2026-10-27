import { mkdir, readFile, rmdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CGROUP_ROOT = '/sys/fs/cgroup';
const CONTROLLERS = ['memory', 'pids', 'cpu'];

/**
 * Prepare a delegated cgroup v2 subtree for sandbox runs:
 *   <own cgroup>/agent  - the worker process itself (cgroup v2 "no internal processes" rule)
 *   <own cgroup>/runs   - parent of one cgroup per sandbox run
 * Works inside a container with a private cgroup namespace and under systemd with Delegate=yes.
 */
export async function setupRunsCgroup(): Promise<string> {
  await access(join(CGROUP_ROOT, 'cgroup.controllers')).catch(() => {
    throw new Error('cgroup v2 is not mounted at /sys/fs/cgroup');
  });
  const self = (await readFile('/proc/self/cgroup', 'utf8')).split('\n').find((l) => l.startsWith('0::'));
  if (!self) throw new Error('process is not in a cgroup v2 hierarchy');
  let rel = self.slice(3).trim();
  if (rel.endsWith('/agent')) rel = rel.slice(0, -'/agent'.length);
  const base = join(CGROUP_ROOT, rel);

  const available = (await readFile(join(base, 'cgroup.controllers'), 'utf8')).trim().split(/\s+/);
  const missing = CONTROLLERS.filter((c) => !available.includes(c));
  if (missing.length) throw new Error(`cgroup controllers not delegated: ${missing.join(', ')}`);

  const agent = join(base, 'agent');
  await mkdir(agent, { recursive: true });
  const procs = (await readFile(join(base, 'cgroup.procs'), 'utf8')).split('\n').filter(Boolean);
  for (const pid of procs) await writeFile(join(agent, 'cgroup.procs'), pid).catch(() => {});

  const enable = CONTROLLERS.map((c) => `+${c}`).join(' ');
  await writeFile(join(base, 'cgroup.subtree_control'), enable);
  const runs = join(base, 'runs');
  await mkdir(runs, { recursive: true });
  await writeFile(join(runs, 'cgroup.subtree_control'), enable);
  return runs;
}

export interface CgroupLimits {
  memoryBytes: number;
  pids: number;
  cpuMsPerSec: number;
}

export class RunCgroup {
  private constructor(readonly path: string) {}

  static async create(runsDir: string, name: string, limits: CgroupLimits): Promise<RunCgroup> {
    const path = join(runsDir, name);
    await mkdir(path);
    const cg = new RunCgroup(path);
    await cg.write('memory.max', String(limits.memoryBytes));
    await cg.write('memory.swap.max', '0').catch(() => {}); // absent when swap accounting is off
    await cg.write('memory.oom.group', '1').catch(() => {});
    await cg.write('pids.max', String(limits.pids));
    // quota per 100ms period: cpuMsPerSec=1000 -> one full core
    await cg.write('cpu.max', `${Math.max(1000, limits.cpuMsPerSec * 100)} 100000`);
    return cg;
  }

  private write(file: string, value: string) {
    return writeFile(join(this.path, file), value);
  }

  private async read(file: string): Promise<string | null> {
    return readFile(join(this.path, file), 'utf8').catch(() => null);
  }

  get procsFile() {
    return join(this.path, 'cgroup.procs');
  }

  async stats(): Promise<{ cpuMs: number; peakMemoryBytes: number; oomKills: number }> {
    const cpu = (await this.read('cpu.stat')) ?? '';
    const usageUsec = Number(/usage_usec (\d+)/.exec(cpu)?.[1] ?? 0);
    const peak = Number((await this.read('memory.peak'))?.trim() ?? 0);
    const events = (await this.read('memory.events')) ?? '';
    const oomKills = Number(/oom_kill (\d+)/.exec(events)?.[1] ?? 0);
    return { cpuMs: usageUsec / 1000, peakMemoryBytes: peak, oomKills };
  }

  /** Kill every process in the cgroup (including escaped grandchildren). */
  async killAll(): Promise<void> {
    const ok = await this.write('cgroup.kill', '1').then(
      () => true,
      () => false,
    );
    if (ok) return;
    const procs = ((await this.read('cgroup.procs')) ?? '').split('\n').filter(Boolean);
    for (const pid of procs) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }

  async isEmpty(): Promise<boolean> {
    return ((await this.read('cgroup.procs')) ?? '').trim() === '';
  }

  async destroy(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (!(await this.isEmpty())) await this.killAll();
      try {
        await rmdir(this.path);
        return;
      } catch {
        await sleep(20);
      }
    }
    throw new Error(`could not remove cgroup ${this.path}`);
  }
}
