import type { SandboxSpec } from './types.ts';

/** Inside-sandbox identity. Mapped to a per-slot host uid via the user namespace. */
export const SANDBOX_UID = 65534;

/** Quote a value as a protobuf text-format string literal. */
function q(value: string): string {
  return JSON.stringify(value);
}

/**
 * Address-space rlimit per runtime. cgroup memory.max is the real memory limit; RLIMIT_AS is a
 * second layer and must sit above it so memory bombs are reported as OOM. V8 reserves large
 * virtual ranges up front, so Node gets a high ceiling.
 */
function addressSpaceMb(spec: SandboxSpec): number {
  if (spec.language === 'node') return 16 * 1024;
  return spec.limits.memoryMb * 4 + 1024;
}

export interface NsjailConfigInput {
  spec: SandboxSpec;
  seccompPolicyPath: string;
  logPath: string;
}

/**
 * Render an nsjail protobuf text config (nsjail 3.4 config.proto field names).
 * All user-controlled values (file names, args) are quoted string literals; nothing goes through a shell.
 */
export function renderNsjailConfig({ spec, seccompPolicyPath, logPath }: NsjailConfigInput): string {
  const [bin, ...args] = spec.command;
  if (!bin) throw new Error('empty command');
  const timeLimitSec = Math.max(1, Math.ceil(spec.limits.wallMs / 1000));
  const lines = [
    'name: "sandbox-run"',
    'mode: ONCE',
    'hostname: "sandbox"',
    'cwd: "/workspace"',
    `time_limit: ${timeLimitSec}`,
    'max_cpus: 1',
    `log_file: ${q(logPath)}`,
    'log_level: INFO',
    'keep_env: false',
    'envar: "PATH=/usr/local/bin:/usr/bin:/bin"',
    'envar: "HOME=/tmp"',
    'envar: "LANG=C.UTF-8"',
    'envar: "PYTHONUNBUFFERED=1"',
    'keep_caps: false',
    'disable_no_new_privs: false',
    // Online runs use the worker network only after per-UID egress rules are installed.
    `clone_newnet: ${!spec.network}`,
    'clone_newuser: true',
    'clone_newns: true',
    'clone_newpid: true',
    'clone_newipc: true',
    'clone_newuts: true',
    'clone_newcgroup: true',
    `uidmap { inside_id: "${SANDBOX_UID}" outside_id: "${spec.hostUid}" count: 1 }`,
    `gidmap { inside_id: "${SANDBOX_UID}" outside_id: "${spec.hostUid}" count: 1 }`,
    // rlimits (MiB for sizes)
    'rlimit_as_type: VALUE',
    `rlimit_as: ${addressSpaceMb(spec)}`,
    'rlimit_fsize_type: VALUE',
    `rlimit_fsize: ${spec.limits.fileSizeMb}`,
    'rlimit_nofile_type: VALUE',
    'rlimit_nofile: 256',
    'rlimit_nproc_type: VALUE',
    `rlimit_nproc: ${spec.limits.pids}`,
    'rlimit_core_type: VALUE',
    'rlimit_core: 0',
    'rlimit_cpu_type: VALUE',
    `rlimit_cpu: ${timeLimitSec + 1}`,
    'rlimit_stack_type: VALUE',
    'rlimit_stack: 8',
    // mounts: read-only rootfs, per-run workspace, capped tmpfs, minimal /dev and /proc
    `mount { src: ${q(spec.rootfsPath)} dst: "/" is_bind: true rw: false }`,
    `mount { src: ${q(spec.workspaceDir)} dst: "/workspace" is_bind: true rw: true nosuid: true nodev: true }`,
    ...(spec.network ? ['mount { src: "/etc/resolv.conf" dst: "/etc/resolv.conf" is_bind: true rw: false }'] : []),
    `mount { dst: "/tmp" fstype: "tmpfs" rw: true options: "size=${spec.limits.tmpfsMb}m,mode=1777" nosuid: true nodev: true }`,
    'mount { dst: "/proc" fstype: "proc" rw: false }',
    // /dev is a tiny tmpfs holding only the three device nodes bound in from the host
    'mount { dst: "/dev" fstype: "tmpfs" options: "size=64k,mode=0755" rw: true nosuid: true noexec: true }',
    'mount { src: "/dev/null" dst: "/dev/null" is_bind: true rw: true }',
    'mount { src: "/dev/zero" dst: "/dev/zero" is_bind: true rw: true }',
    'mount { src: "/dev/urandom" dst: "/dev/urandom" is_bind: true rw: true }',
    `seccomp_policy_file: ${q(seccompPolicyPath)}`,
    'seccomp_log: true',
    `exec_bin { path: ${q(bin)} ${args.map((a) => `arg: ${q(a)}`).join(' ')} }`,
  ];
  return lines.join('\n') + '\n';
}
