# Security

**Statement of scope.** Sandboxing on Linux with namespaces, cgroups, seccomp and rlimits is defense in depth, not an
absolute guarantee. This system provides **layered isolation and resource containment**. The host kernel stays in the
trusted computing base: a kernel vulnerability reachable through the allowed syscalls could let code escape. For
hostile workloads at scale, gVisor or Firecracker microVMs are the recommended next step (future work).

## Trust boundaries

### 1. Internet → API

| Control | Where |
|---|---|
| TLS terminates at a reverse proxy in front of the API (not in this repo; see RUNBOOK). | deployment |
| argon2id password hashes. Unknown emails still verify against a dummy hash, so timing doesn't reveal which accounts exist. | `apps/api/src/routes/auth.ts` |
| Session JWT in an httpOnly, SameSite=Lax cookie, Secure when `COOKIE_SECURE=true`. In production the API refuses to start with the placeholder `JWT_SECRET`. | `apps/api/src/auth/session.ts`, `src/config.ts` |
| CSRF: a signed double submit. The JWT's `csrf` claim must match the `x-csrf-token` header on cookie-authenticated POST, PATCH and DELETE requests. | `apps/api/src/auth/session.ts` |
| API keys: only `sha256(secret)` and the prefix are stored, compared in constant time, cached 60s, and invalidated on revoke. | `apps/api/src/auth/apikeys.ts` |
| Per-tenant token-bucket rate limit, a cap of 200 queued jobs per tenant, and limits that are rejected rather than raised. | `apps/api/src/ratelimit.ts`, `src/jobManager.ts`, `packages/shared/src/limits.ts` |
| Helmet headers, CORS allowlist (`WEB_ORIGIN`), 2.5 MB body limit, JSON only (other content types get 415). | `apps/api/src/app.ts` |
| zod validates every input. File paths cannot be absolute or contain `..`, NUL or backslash. | `packages/shared/src/schemas.ts`, `paths.ts` |
| Parameterized SQL only. The column names used in dynamic updates come from whitelists. | `packages/db/src/**` |
| Logs record ids and sizes only, never source, stdin, stdout or secrets. | API and worker loggers |
| `/metrics` is not proxied by nginx. It must not be exposed publicly. | `infra/docker/nginx.conf` |

### 2. Control plane → worker plane

- Workers run on dedicated VMs in a private subnet, with **no inbound ports** and egress only to Postgres, Redis, S3,
  DNS and NTP (`infra/worker-vm/firewall.sh`).
- Workers authenticate to Postgres as a login role in **`worker_role`**. That role has no table privileges; it can only
  execute the SECURITY DEFINER functions `worker_register`, `worker_claim`, `worker_heartbeat`, `worker_advance` and
  `worker_complete` (`packages/db/migrations/1730000000001_worker-functions.sql` and `…0002_fence-on-lease-expiry.sql`).
  A worker cannot read `users`, `api_keys` or other tenants' rows. The integration tests assert "permission denied".
- **Fencing:** every write a worker makes is conditioned on `(execution id, attempt, lease_owner)`, and completion also
  requires an unexpired lease. A stale worker cannot overwrite a newer attempt, and result keys in S3 include the
  attempt number.
- The intended S3 credentials for workers are scoped to `tenants/*` get and put, plus delete on attempt prefixes. The
  IAM policy itself is deployment-specific and not in this repo.

### 3. Worker agent → sandbox

Configured per run in `packages/sandbox/src/nsjail-config.ts` and `cgroup.ts`:

- **Namespaces:** new user, PID, mount, network, IPC, UTS and cgroup namespaces. The network namespace has only
  loopback, so there is no route to the Internet, the host or `169.254.169.254`.
- **Identity:** uid and gid 65534 inside the sandbox, mapped to a **per-slot host uid (200000 + slot index)**, so
  concurrent runs never share a kernel uid. All capabilities are dropped and `no_new_privs` is set. The environment is
  explicitly empty apart from PATH, HOME, LANG and PYTHONUNBUFFERED, so no worker env vars or credentials leak in.
- **cgroup v2, owned by the worker:** `memory.max` (no swap), `pids.max` (default 64), and `cpu.max` (default one
  core). Every descendant is killed with `cgroup.kill` at the end of the run.
- **rlimits:** address space, fsize (16 MB), nofile (256), nproc, core = 0, cpu and stack.
- **Time:** nsjail's `time_limit` plus a worker watchdog that kills the process group and the cgroup.
- **Mounts:**
  - The language rootfs is bind-mounted read-only. It is stripped of package managers and caches
    (`infra/rootfs/strip-rootfs.sh`).
  - `/workspace` is a per-run directory, backed by a per-run 128 MB tmpfs when the worker is root, with nosuid and
    nodev.
  - `/tmp` is a size-capped tmpfs.
  - `/dev` is a tiny tmpfs holding only null, zero and urandom.
  - `/proc` is mounted for the PID namespace only.
- **seccomp-bpf** (kafel, `infra/nsjail/seccomp/base.kafel` plus `node.kafel` and `gcc.kafel`), with
  `DEFAULT KILL_PROCESS`:
  - **Allowlist** of the syscalls the runtimes need. `clone` is allowed only without `CLONE_NEW*` flags, and
    `personality` only with 0 or a query.
  - **Killed explicitly:** mount, umount, pivot_root, chroot, ptrace, unshare, setns, keyctl, add_key, request_key,
    bpf, perf_event_open, kexec_*, *_module, reboot, swapon, swapoff, acct, userfaultfd, process_vm_readv/writev,
    open_by_handle_at, name_to_handle_at, the new mount API, syslog, and others.
  - **Denied with EPERM:** `socket` and `socketpair` (every address family), chown, setuid and setgid family calls,
    and xattrs. Programs get a clean error instead of being killed.
  - **Denied with ENOSYS** so runtimes fall back cleanly: clone3 (its arguments can't be filtered by BPF), io_uring,
    pkey_*, landlock and AIO.
- **stdio:** stdin comes from a file; stdout and stderr are capped at 1 MB each and marked truncated.

The abuse suite (`packages/sandbox/test/abuse/abuse.test.ts`) exercises: an infinite loop, a memory bomb, a fork bomb,
network access to external, host and metadata addresses, host file reads, writes to the rootfs, forbidden syscalls, an
output flood, oversized files, file-descriptor exhaustion, deep recursion and zombie processes.

### 4. Tenant → tenant

- Every tenant query goes through tenant-scoped repositories (`ExecutionRepo` and `ApiKeyRepo` are constructed with a
  `tenantId`). Another tenant's ids return **404**, never 403. Integration tests cover executions, logs, results,
  cancel and API key deletion.
- S3 keys are generated server side under `tenants/{tenantId}/…`; clients cannot choose them.
- Sandboxes share nothing writable: a fresh run directory and tmpfs each time, a separate cgroup, a separate host uid,
  and a read-only rootfs.
- Fair claiming plus `max_concurrent` per tenant limit noisy neighbours. One tenant cannot use up all the slots.

## Worker VM hardening (`infra/worker-vm/setup.sh`, `firewall.sh`)

- A dedicated VM; Docker is used only at provisioning time to build each rootfs, then disabled.
- iptables:
  - Default DROP for input and output.
  - The metadata address `169.254.169.254` is reachable only by uid 0 (the agent).
  - The sandbox uid range has no egress at all.
  - Egress is allowlisted to the Postgres, Redis and S3 CIDRs.
- sysctls: `unprivileged_bpf_disabled=1`, `kptr_restrict=2`, `dmesg_restrict=1`, IPv6 disabled.
- Require IMDSv2 with hop limit 1. This is set through the cloud API; the command is in `setup.sh`.
- The systemd unit uses `Delegate=yes` for the cgroup subtree, and runs the self-test as `ExecStartPre`, so a worker
  never claims jobs if isolation checks fail.

## Secrets

- Secrets come from the environment or a secret manager and are never committed. `.env.example` lists every variable
  with placeholder values, and `.env*` is gitignored.
- Rotation steps for `JWT_SECRET` and the worker DB password are in [RUNBOOK.md](RUNBOOK.md).
- In production, the bucket is private with SSE enabled and virtual-hosted addressing.

## Dependency audit and patch cadence

- CI (`.github/workflows/ci.yml`) runs `pnpm audit --prod --audit-level high` on every push and PR, and builds the
  worker image and runs the self-test and abuse suite with real nsjail.
- **Kernel:** apply security updates weekly and reboot workers through drain (SIGTERM, `DRAIN_SECONDS`). Apply
  critical CVEs as soon as possible.
- **nsjail:** pinned (`NSJAIL_VERSION=3.4` in `infra/docker/worker.Dockerfile` and `setup.sh`). Review releases
  monthly. On upgrade, check `config.proto` field names and rerun the abuse suite.
- **Runtimes** (python:3.12-slim, node:20-slim, gcc:13): rebuild each rootfs monthly, or sooner for CVEs, using
  `infra/rootfs/build-rootfs.sh`. Rerun the self-test and the abuse suite, and adjust the seccomp policy if a new
  runtime needs new syscalls.

## Future work

- gVisor (runsc) or Firecracker microVMs per run, to take the host kernel out of the direct syscall path.
- Per-tenant worker pools for the highest-risk tenants.
- A restricted, non-owner Postgres role for the API.
