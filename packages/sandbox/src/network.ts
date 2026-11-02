import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const privateV4 = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.168.0.0/16', '192.0.0.0/24', '192.0.2.0/24',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
];

/**
 * An online nsjail uses the worker's current network namespace: the container's
 * in Compose, or the VM's under systemd. Install both families before starting code.
 * Each slot already has a distinct mapped host UID; children cannot change it.
 */
export class RunEgress {
  private readonly chain = `gc_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  private readonly families: { command: string; attached: boolean }[] = [];

  private constructor(private readonly uid: number) {}

  private async rule(command: string, ...args: string[]) {
    await exec(command, ['-w', '5', ...args], { timeout: 10000 });
  }

  static async create(uid: number): Promise<RunEgress> {
    if (!Number.isSafeInteger(uid) || uid < 200000 || uid >= 300000) throw new Error('invalid sandbox network UID');
    const guard = new RunEgress(uid);
    try {
      const resolvers = (await readFile('/etc/resolv.conf', 'utf8')).split('\n')
        .map(line => /^\s*nameserver\s+(\S+)/.exec(line)?.[1])
        .filter((value): value is string => !!value && !value.includes('%') && isIP(value) !== 0);
      await guard.install('iptables', 4, resolvers);
      // No IPv6 rules are needed only when the kernel lacks IPv6 or explicitly
      // disables it for all current and future interfaces. Otherwise fail closed.
      const flags = await Promise.all(['all', 'default'].map(async iface => {
        try { return (await readFile(`/proc/sys/net/ipv6/conf/${iface}/disable_ipv6`, 'utf8')).trim(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '1'; throw error; }
      }));
      if (!flags.every(flag => flag === '1')) await guard.install('ip6tables', 6, resolvers);
      return guard;
    } catch (error) {
      await guard.destroy();
      throw new Error(`internet firewall setup failed (iptables permissions/tools required): ${(error as Error).message}`);
    }
  }

  private async install(command: string, family: 4 | 6, resolvers: string[]) {
    await this.rule(command, '-N', this.chain);
    const record = { command, attached: false };
    this.families.push(record);
    for (const resolver of resolvers.filter(address => isIP(address) === family)) {
      for (const protocol of ['udp', 'tcp']) {
        // Match the original DNS destination: Docker rewrites 127.0.0.11:53 to
        // an internal resolver port before filter/OUTPUT sees the packet.
        await this.rule(command, '-A', this.chain, '-p', protocol, '-m', 'conntrack', '--ctdir', 'ORIGINAL',
          '--ctorigdst', resolver, '--ctorigdstport', '53', '-j', 'ACCEPT');
      }
    }
    if (family === 4) {
      for (const cidr of privateV4) await this.rule(command, '-A', this.chain, '-d', cidr, '-j', 'REJECT');
      await this.rule(command, '-A', this.chain, '-p', 'tcp', '-j', 'ACCEPT');
      await this.rule(command, '-A', this.chain, '-p', 'udp', '-j', 'ACCEPT');
    } else {
      // Global-unicast IPv6 only; loopback, local, multicast and mapped prefixes
      // cannot fall through into an unrestricted allow rule.
      await this.rule(command, '-A', this.chain, '-d', '2000::/3', '-p', 'tcp', '-j', 'ACCEPT');
      await this.rule(command, '-A', this.chain, '-d', '2000::/3', '-p', 'udp', '-j', 'ACCEPT');
    }
    await this.rule(command, '-A', this.chain, '-j', 'REJECT');
    await this.rule(command, '-I', 'OUTPUT', '1', '-m', 'owner', '--uid-owner', String(this.uid), '-j', this.chain);
    record.attached = true;
  }

  /** Called after the cgroup is empty; never remove protection from live code. */
  async destroy(): Promise<void> {
    for (const { command, attached } of this.families.reverse()) {
      if (attached) {
        try { await this.rule(command, '-D', 'OUTPUT', '-m', 'owner', '--uid-owner', String(this.uid), '-j', this.chain); }
        catch { continue; } // Keep the restrictive chain if its jump cannot be removed.
      }
      await this.rule(command, '-F', this.chain).catch(() => {});
      await this.rule(command, '-X', this.chain).catch(() => {});
    }
    this.families.length = 0;
  }
}
