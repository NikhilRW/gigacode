# BUILD_SPEC: Sandboxed Multi-Tenant Code Execution Engine

You are building this entire application end to end. Read this whole file first, then build in the phases listed in section 17. Do not ask questions. Where something is unspecified, use the assumptions in section 18 and record any new assumption in `docs/ASSUMPTIONS.md`.

## 0. Rules for you (the builder)

1. Untrusted user code must NEVER run inside the API process, the worker process itself, or any process that holds credentials. It runs only inside a sandbox (section 7).
2. Never use `eval`, `vm`, `vm2`, `isolated-vm` or similar in-process "sandboxes".
3. Never mount `/var/run/docker.sock` into the API. (The dev-only Docker sandbox driver may use it in the worker, clearly flagged as insecure.)
4. Never store source code or logs in Postgres. They go to S3. Postgres stores metadata only.
5. Never log source code, stdin, stdout or secrets. Log ids and sizes only.
6. Every DB query touching tenant data must be scoped by `tenant_id`. Enforce this in a repository layer, and add tests for cross-tenant access.
7. Do not claim the sandbox is "secure" or "unbreakable" in docs or UI. Say: layered isolation and resource containment. The host kernel stays in the trusted computing base.
8. Write tests as you go (section 15). A phase is not done until its "done when" checks pass.
9. Keep code simple and readable. TypeScript strict mode everywhere. Small files, clear names.
10. Commit after each phase with a clear message.

## 1. What the system does

A client submits source code plus limits. The platform stores the source in S3, queues a job, a worker on a cloud VM claims it, runs it inside a Linux sandbox (namespaces + cgroups v2 + seccomp, no network), captures stdout, stderr, exit status and resource usage, stores results in S3, updates state in Postgres, and the client reads results through the API or a React dashboard.

Core principle: cloud primitives (VMs, object store, DB, cache) provide compute and storage. The custom platform provides tenancy, scheduling, leases, sandbox configuration, lifecycle management and a stable API on top.

## 2. Tech stack (fixed)

| Area | Choice |
|---|---|
| Language | TypeScript (strict) on Node.js 20 LTS |
| Monorepo | pnpm workspaces |
| API | Fastify, zod for validation, pino logging, prom-client metrics |
| DB | PostgreSQL 16, plain `pg` driver, SQL migrations via `node-pg-migrate` |
| Cache / ephemeral | Redis 7 via `ioredis` |
| Object storage | S3 via AWS SDK v3. MinIO for local dev. |
| Sandbox | `nsjail` (primary), Docker driver (dev fallback only) |
| Frontend | React 18 + Vite + TypeScript, React Router, TanStack Query, Tailwind CSS, Monaco editor |
| Tests | Vitest, Supertest, Testcontainers (or docker compose based), Playwright (smoke) |
| Local infra | docker compose |

## 3. Repository layout

```
/
  apps/
    api/            Fastify HTTP API (control plane)
    worker/         Worker agent (worker plane)
    web/            React dashboard
  packages/
    shared/         zod schemas, types, state machine, language configs, constants
    db/             migrations, repositories, claim/lease SQL
    sandbox/        SandboxDriver interface + NsjailDriver + DockerDriver
    storage/        S3 wrapper (put, get, presign, delete)
  infra/
    docker-compose.yml
    docker/         Dockerfiles (api, worker, web)
    rootfs/         scripts and Dockerfiles that build per-language sandbox rootfs
    nsjail/         nsjail configs and seccomp policies
    worker-vm/      systemd unit, iptables rules, setup script for a worker VM
  scripts/          seed, chaos tests, load test
  docs/             ARCHITECTURE.md, SECURITY.md, FAILURES.md, RUNBOOK.md, ASSUMPTIONS.md
  BUILD_SPEC.md
```

## 4. Architecture (map to the design diagram)

- **API Gateway layer** inside `apps/api`: TLS terminates at a reverse proxy in prod; the API does authN/authZ, request validation, per-tenant rate limiting.
- **Control plane** (`apps/api`): Tenant Manager (quota + policy), Job Manager + Artifact Manager (write path), Result Manager (read path, read only), Reaper + Reconciler (background loop, runs inside the API process under a Postgres advisory lock so only one instance runs it at a time).
- **Data services**: Postgres (metadata, job queue, leases, attempts), Redis (rate limits, status cache, pub/sub, worker liveness), S3 (source, input, logs, results).
- **Job queue**: implemented as the `executions` table in Postgres using `FOR UPDATE SKIP LOCKED` claims, a lease, an attempt counter and a dead-letter status. This replaces a separate broker and removes the dual-write problem between DB and queue. Keep the queue behind an interface (`JobQueue`) in `packages/db` so it could be swapped for a broker later.
- **Worker plane** (`apps/worker`): runs on cloud VMs. Has no inbound ports. Claims jobs, holds leases, runs sandboxes, uploads results.
- **Autoscaler**: not implemented in code. Expose metrics (section 13) and document how an ASG or Kubernetes HPA would scale on `queue_depth` and `oldest_queued_age_seconds` in `docs/RUNBOOK.md`.

Client never talks to workers. Workers never talk to clients.

## 5. Data model (Postgres)

Create these tables with migrations. Use `uuid` primary keys (generate in app with `crypto.randomUUID()`), `timestamptz` everywhere.

```
tenants(
  id, name, created_at,
  max_concurrent int default 4,
  max_exec_per_min int default 60,
  max_timeout_ms int default 10000,
  max_memory_mb int default 512,
  max_source_bytes int default 1048576
)
users(id, tenant_id, email unique, password_hash, role, created_at)
  -- role in ('owner','member','platform_admin')
api_keys(id, tenant_id, name, prefix, key_hash, last_used_at, revoked_at, created_at)
executions(
  id, tenant_id, created_by_user_id null, api_key_id null,
  idempotency_key null, request_hash,
  language, entry_file, status, priority int default 0,
  limits jsonb,                 -- timeoutMs, memoryMb, cpuMsPerSec, pids
  artifact_prefix,              -- S3 prefix of source/input
  attempt int default 0, max_attempts int default 3,
  available_at timestamptz,     -- for retry backoff
  lease_owner text null, lease_expires_at timestamptz null,
  cancel_requested bool default false,
  exit_code int null, term_signal text null, failure_reason text null,
  wall_ms int null, cpu_ms bigint null, peak_memory_bytes bigint null,
  stdout_truncated bool default false, stderr_truncated bool default false,
  created_at, queued_at, started_at, finished_at
)
execution_attempts(
  id, execution_id, attempt int, worker_id, started_at, finished_at,
  outcome, exit_code, result_prefix, unique(execution_id, attempt)
)
execution_events(id bigserial, execution_id, attempt, from_status, to_status, at, detail jsonb)
workers(id text pk, hostname, version, slots int, status, started_at, last_heartbeat_at)
tenant_concurrency(tenant_id pk, running int not null default 0)
```

Indexes (at minimum):
- `executions (status, priority desc, available_at, created_at) WHERE status = 'QUEUED'`
- `executions (tenant_id, created_at desc)`
- `executions (lease_expires_at) WHERE status IN ('DISPATCHED','STARTING','RUNNING')`
- unique `executions (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`

Create a restricted Postgres role `worker_role` for workers: it can only execute the claim, heartbeat and complete functions/queries it needs (SELECT/UPDATE on specific `executions` columns, INSERT on `execution_attempts` and `execution_events`, upsert on `workers`). It cannot read `users`, `api_keys` or other tenants' metadata beyond the claimed job row.

## 6. Execution state machine

States: `CREATED, QUEUED, DISPATCHED, STARTING, RUNNING, SUCCESS, FAILED, TIMEOUT, CANCELLED, DEAD_LETTERED`.

Terminal: `SUCCESS, FAILED, TIMEOUT, CANCELLED, DEAD_LETTERED`.

Allowed transitions (put in `packages/shared`, one function `canTransition(from, to)`):

```
CREATED     -> QUEUED, FAILED
QUEUED      -> DISPATCHED, CANCELLED, DEAD_LETTERED
DISPATCHED  -> STARTING, QUEUED (lease expired), CANCELLED
STARTING    -> RUNNING, FAILED, QUEUED (lease expired), CANCELLED
RUNNING     -> SUCCESS, FAILED, TIMEOUT, CANCELLED, QUEUED (lease expired)
```

Rules:
- FAILED means the user's program failed (non-zero exit, out of memory, killed by seccomp) or sandbox setup failed. It is final and NOT retried.
- Infrastructure failures (worker died, lease expired) go back to `QUEUED` with `attempt` kept and `available_at = now() + backoff` (5s, 20s, 60s). When `attempt >= max_attempts`, go to `DEAD_LETTERED`.
- Every transition is a compare-and-set UPDATE (`WHERE id = $1 AND status = $expected`), runs in a transaction with an `execution_events` insert, and publishes to Redis channel `exec:{id}` after commit.
- All transitions go through one module (`transitionExecution`). No ad hoc status updates elsewhere.

## 7. Sandbox design (the most important part)

### 7.1 Interface

```ts
interface SandboxDriver {
  selfTest(): Promise<void>;                       // throws if environment unsuitable
  run(spec: SandboxSpec, signal: AbortSignal): Promise<SandboxResult>;
}
```
`SandboxSpec`: language, rootfs path, workspace dir (host path), command + args, stdin file path, limits (wallMs, memoryMb, cpuMsPerSec, pids, fileSizeMb, outputBytes, tmpfsMb), network disabled (always).
`SandboxResult`: exitCode, termSignal, timedOut, oomKilled, wallMs, cpuMs, peakMemoryBytes, stdoutPath, stderrPath, stdoutTruncated, stderrTruncated, killedBySeccomp.

### 7.2 NsjailDriver (default, required)

Use `nsjail` pinned to a specific release built in the worker image/VM setup script. Write configs as nsjail protobuf config files generated per run (do not build shell strings from user input; pass args as an array to `spawn`, never through a shell). Verify option names against the pinned nsjail version's documentation before using them.

Each run must have ALL of:
- New namespaces: user, PID, mount, network, IPC, UTS, cgroup. Network namespace with no interfaces except loopback (so no external network, no cloud metadata access).
- cgroup v2 limits per run: memory max (no swap), pids max (default 64), CPU quota (default 1 core).
- rlimits: address space, file size, open files, nproc, core = 0.
- Wall-clock time limit enforced by nsjail AND a second watchdog in the worker (kill the nsjail process group if it overruns by 1s).
- seccomp-bpf policy, default action KILL, allowlist of syscalls needed for the supported runtimes. Policy lives in `infra/nsjail/seccomp/*.kafel`. Build it iteratively with test programs and `strace`; keep one base policy plus small per-language additions.
- Mounts: per-language rootfs bind-mounted READ-ONLY; `/workspace` (user files, from a per-run host dir) and `/tmp` as size-capped tmpfs; minimal `/dev` (null, zero, urandom) and `/proc` (pid namespace only). Nothing else from the host. No shared writable directory between runs.
- Runs as an unprivileged uid/gid mapped from the user namespace, all capabilities dropped, `no_new_privs` set.
- stdin from file, stdout and stderr redirected to files with a byte cap (default 1 MB each, mark `*_truncated`).

The seccomp policy must explicitly deny at least: `mount, umount2, pivot_root, chroot, ptrace, unshare, setns, clone3 with new namespaces, keyctl, add_key, request_key, bpf, perf_event_open, io_uring_setup, kexec_load, init_module, finit_module, delete_module, reboot, swapon, swapoff, acct, personality (non-default), userfaultfd, process_vm_readv, process_vm_writev, open_by_handle_at, name_to_handle_at`, and all socket-creating syscalls other than `AF_UNIX` is not needed either, so deny `socket` entirely unless a runtime proves it needs it.

### 7.3 Compile then run

Languages with a compile step (C, C++) run two sandbox invocations: compile (wall 10s, memory 512 MB, output to `/workspace/out`), then run with the tenant's limits. Both use the same isolation. Compile failure returns `FAILED` with compiler output in stderr.

### 7.4 Languages (in `packages/shared/languages.ts`)

| id | rootfs | compile | run |
|---|---|---|---|
| python | python 3.12 slim | none | `python3 main.py` |
| node | node 20 slim | none | `node index.js` |
| c | gcc | `gcc -O2 -o out main.c` | `./out` |
| cpp | g++ | `g++ -O2 -std=c++17 -o out main.cpp` | `./out` |

`infra/rootfs/` has a script per language that builds a Docker image, runs `docker export`, and unpacks it to `/opt/sandbox/rootfs/<lang>` on the worker VM. Rootfs contains only runtime + stdlib, no package managers, no secrets, no credentials.

### 7.5 DockerDriver (dev fallback, flagged insecure)

For machines where nsjail and cgroup v2 are unavailable (e.g. macOS Docker Desktop). Uses `docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --security-opt seccomp=<profile.json> --memory --memory-swap --pids-limit --cpus --user 65534 --tmpfs /tmp:size=...`. Selected with `SANDBOX_DRIVER=docker`. Prints a loud warning at worker start: "DEV ONLY: requires docker socket, weaker isolation". Never the default and refuse to start with it when `NODE_ENV=production`.

### 7.6 Worker self-test at startup

Before claiming any job the worker verifies: nsjail binary present and correct version, cgroup v2 mounted and delegated, rootfs exist for each enabled language, a hello-world run per language succeeds, a network-egress probe from inside the sandbox FAILS, a fork-bomb probe is contained. If any check fails, exit non-zero.

## 8. Write path (client submits code)

`POST /v1/executions`

Request body:
```json
{
  "language": "python",
  "files": [{ "path": "main.py", "content": "print('hi')" }],
  "entryFile": "main.py",
  "stdin": "",
  "limits": { "timeoutMs": 5000, "memoryMb": 256 }
}
```
Headers: `Authorization: Bearer <api key>` (or session cookie from the dashboard), optional `Idempotency-Key`.

Steps in `Job Manager`:
1. Authenticate, load tenant.
2. Rate limit (Redis token bucket per tenant, `max_exec_per_min`). On limit: `429` with `Retry-After`.
3. Validate with zod: language supported, file paths safe (no `..`, no absolute, no NUL, max 20 files, max `max_source_bytes` total, stdin max 256 KB), limits clamped to tenant maximums (reject, do not silently raise).
4. Idempotency: if key exists for tenant with same `request_hash` return the existing execution (`200`); different hash returns `409`.
5. Insert `executions` row as `CREATED` (transaction) and an event row.
6. Upload files and stdin to S3 under `tenants/{tenantId}/executions/{id}/source/...`. Retry with backoff. If it still fails: mark `FAILED` (`failure_reason=artifact_upload_failed`), return `503`.
7. Transition `CREATED -> QUEUED` (sets `queued_at`, `available_at = now()`). Return `202 {id, status: "QUEUED"}`.
8. Concurrency quota is enforced at claim time, not here. A tenant can queue more than `max_concurrent` jobs. Also cap queued jobs per tenant (default 200) and return `429` beyond that.

Clients choose nothing about S3 keys. Keys are always generated server side.

## 9. Worker execution path

Worker process (`apps/worker`) config: `WORKER_ID` (default hostname + random), `WORKER_SLOTS` (default CPU cores), `LEASE_SECONDS=30`, `HEARTBEAT_SECONDS=5`, `POLL_INTERVAL_MS=500` (with jitter; use Redis pub/sub `queue:wake` as an optional wake-up hint, polling is the source of truth).

Each slot loops:
1. **Claim** with one SQL statement in a transaction:
   - Select the best `QUEUED` row with `available_at <= now()` using `FOR UPDATE SKIP LOCKED`, skipping rows of tenants at their `max_concurrent` (maintain `tenant_concurrency` in the same transaction with a guarded `UPDATE ... SET running = running + 1 WHERE running < max RETURNING`). Order by `priority desc`, then fair across tenants (oldest tenant `last_dispatched` first), then `created_at`.
   - Set `status='DISPATCHED'`, `attempt = attempt + 1`, `lease_owner`, `lease_expires_at = now() + lease`.
   - Insert `execution_attempts` row.
2. **Heartbeat** every 5s while the job is in progress: `UPDATE executions SET lease_expires_at = now() + lease WHERE id=$1 AND lease_owner=$2 AND attempt=$3`. If 0 rows are updated, the lease was lost: kill the sandbox immediately and discard the result. The same heartbeat reads `cancel_requested` and kills the sandbox if set. Also `SET worker:{id}` in Redis with TTL 15s containing load info, and upsert `workers`.
3. **Starting**: `DISPATCHED -> STARTING`. Create a fresh per-run directory under `/var/lib/worker/runs/{executionId}-{attempt}`, mode 0700, owned by the worker user. Download source files from S3 into it. Verify sizes and checksums.
4. **Run**: `STARTING -> RUNNING`, call `SandboxDriver.run`. Collect result.
5. **Upload** `stdout.log`, `stderr.log`, `result.json` to `tenants/{t}/executions/{id}/attempts/{n}/`. Retry with backoff. Keys include the attempt number so a late duplicate attempt can never overwrite the authoritative result.
6. **Complete (fenced)**: 
   ```sql
   UPDATE executions SET status=$new, exit_code=..., ... 
   WHERE id=$1 AND attempt=$2 AND lease_owner=$3 AND status IN ('STARTING','RUNNING')
   ```
   If 0 rows: this attempt lost authority. Delete its uploaded objects and move on. Otherwise decrement `tenant_concurrency`, insert events, publish `exec:{id}`.
7. **Cleanup in `finally`**: kill leftover processes, remove the run directory, release the slot. Cleanup runs even on failure or crash handling paths.

Result mapping: exit 0 -> `SUCCESS`; wall timeout -> `TIMEOUT`; cancelled -> `CANCELLED`; anything else from user code (non-zero exit, signal, OOM, seccomp kill) -> `FAILED` with `failure_reason` in (`runtime_error`, `oom`, `killed_by_signal`, `seccomp_violation`, `compile_error`, `sandbox_setup_error`).

Graceful shutdown (SIGTERM): stop claiming, mark worker `draining`, wait up to `DRAIN_SECONDS` (default 30) for running jobs; any still running are killed and left to lease expiry for requeue.

## 10. Read path (client reads results)

All reads go through the API. Clients never contact workers.

- `GET /v1/executions/:id` -> metadata and status. Reads Redis cache first (key `exec:{tenant}:{id}`; TTL 2s for non-terminal states, 1h for terminal; invalidate on every transition). On miss, read from the read replica if `DATABASE_READ_URL` is set, falling back to the primary.
- `GET /v1/executions` -> cursor paginated list, filters: status, language, date range.
- `GET /v1/executions/:id/logs?stream=stdout|stderr` -> returns `{url, expiresAt}` presigned S3 URL (60s) for the authoritative attempt. Optional `?inline=true` streams up to 1 MB through the API for the dashboard.
- `GET /v1/executions/:id/result` -> parsed `result.json`.
- `GET /v1/executions/:id/events` -> Server-Sent Events: sends current state immediately, then updates from Redis pub/sub, heartbeat comment every 15s, closes on terminal state. Cookie auth only (EventSource cannot set headers). API-key clients poll.
- `POST /v1/executions/:id/cancel` -> if `QUEUED`: transition to `CANCELLED` directly. If running: set `cancel_requested=true`, return `202`; the worker finishes the transition.

Every read verifies `tenant_id` matches the caller. Return `404` (not `403`) for other tenants' ids.

## 11. Other API

Auth and accounts (dashboard):
- `POST /v1/auth/register` (creates tenant + owner), `POST /v1/auth/login`, `POST /v1/auth/logout`, `GET /v1/me`.
- Passwords: argon2id. Session: signed JWT in an httpOnly, Secure, SameSite=Lax cookie, plus a CSRF token (double submit) for state-changing cookie requests.

API keys:
- `POST /v1/api-keys` (returns the full key once, format `ce_live_<prefix>_<secret>`), `GET /v1/api-keys`, `DELETE /v1/api-keys/:id`. Store only SHA-256 of the secret plus the prefix; compare in constant time; cache key lookups in Redis for 60s and invalidate on revoke.

Tenant:
- `GET /v1/usage` -> executions today, running, queued, total CPU ms, limits.

Admin (`platform_admin` only):
- `GET /v1/admin/workers`, `GET /v1/admin/queue` (depth, oldest age, by tenant), `GET /v1/admin/dlq`, `POST /v1/admin/dlq/:id/requeue`, `GET /v1/admin/tenants`, `PATCH /v1/admin/tenants/:id/limits`.

Ops:
- `GET /healthz` (process up), `GET /readyz` (Postgres, Redis, S3 reachable), `GET /metrics` (Prometheus, not exposed publicly).

Error format everywhere: `{ "error": { "code": "string", "message": "string", "requestId": "string" } }`. Version the API under `/v1`. Generate an OpenAPI document from the zod schemas and serve it at `/docs`.

## 12. Background tasks (Reaper + Reconciler)

Runs every 10s in the API process, guarded by `pg_try_advisory_lock`. Each pass:
1. **Expired leases**: jobs in `DISPATCHED, STARTING, RUNNING` with `lease_expires_at < now()`. If `attempt >= max_attempts` -> `DEAD_LETTERED`. Else -> `QUEUED` with backoff `available_at`. Decrement `tenant_concurrency`. Log and count each.
2. **Stuck CREATED**: older than 60s. If the S3 source exists -> `QUEUED`, otherwise -> `FAILED` (`artifact_missing`).
3. **Counter healing**: recompute `tenant_concurrency.running` from actual rows and fix drift.
4. **Dead workers**: mark workers with no heartbeat for 30s as `dead`.
5. **Retention**: delete S3 objects and rows older than `RETENTION_DAYS` (default 30) for terminal executions. Also configure an S3 lifecycle rule as a backstop.

## 13. Observability

Prometheus metrics: `http_requests_total`, `http_request_duration_seconds`, `executions_created_total`, `executions_finished_total{status}`, `queue_depth`, `oldest_queued_age_seconds`, `sandbox_slots_busy`, `sandbox_slots_total`, `lease_expirations_total`, `dead_lettered_total`, `fenced_results_discarded_total`, `rate_limited_total`, `s3_errors_total`, `db_errors_total`, `redis_errors_total`.

Structured logs (pino) with `requestId`, `tenantId`, `executionId`, `attempt`, `workerId`. Add `X-Request-Id` header propagation. Provide a ready Grafana dashboard JSON in `infra/` (optional).

## 14. Frontend (React)

Clean, simple, responsive UI (Tailwind). Pages:
1. **Login / Register**.
2. **Dashboard**: running, queued, last 24h success rate, recent executions table, usage vs limits.
3. **New Execution**: Monaco editor (multi-file tabs, max 20), language dropdown, stdin box, limits inputs (clamped to tenant maximums), Run button. After submit show live status chip and a state timeline fed by SSE, then stdout/stderr panels, exit code, wall time, CPU time, peak memory.
4. **Executions list**: filters (status, language, date), cursor pagination, click to open detail.
5. **Execution detail**: metadata, state timeline from `execution_events`, attempts table, logs viewer with truncation notice, "Cancel" button while active, "Re-run" button (creates a new execution with the same files).
6. **API Keys**: create (show once, copy button), list, revoke, plus a copy-paste curl example.
7. **Admin** (only for platform_admin): Workers (liveness, slots busy), Queue (depth, oldest age, per tenant), Dead-letter list with requeue, Tenants and limits editor.

Technical requirements: typed API client generated from or sharing zod types from `packages/shared`; TanStack Query for data; handle `429`, `401`, network errors with clear messages; never render logs as HTML (always as text); keyboard accessible; light and dark mode.

## 15. Testing requirements

**Unit**: state machine transitions, request validation, path sanitization, limit clamping, idempotency hashing, backoff calculation.

**Integration** (real Postgres, Redis, MinIO):
- Submit -> worker runs -> `SUCCESS` with correct stdout.
- Two tenants cannot read each other's executions, logs or API keys (expect `404`).
- Idempotency key replay and conflict.
- Rate limit returns `429`.
- Concurrency cap: tenant with `max_concurrent=1` never runs two at once; other tenants are not blocked (fairness).
- Cancel queued and cancel running.

**Sandbox abuse suite** (requires Linux with nsjail; mark clearly if skipped). Each must end contained, with the right terminal state, and leave the worker healthy and clean:
- infinite loop -> `TIMEOUT`
- memory bomb -> `FAILED` (`oom`), worker memory unaffected
- fork bomb -> contained by pids limit
- network: connect to `1.1.1.1`, `127.0.0.1` services on the host, `169.254.169.254` -> all fail
- read host files (`/etc/shadow`, `/proc/1/environ`, worker run dir, other tenants' dirs) -> not visible
- write to rootfs -> read-only error
- forbidden syscalls (`mount`, `ptrace`, `unshare`, `keyctl`, `bpf`) -> `seccomp_violation`
- stdout flood (1 GB) -> truncated at cap, job finishes
- very large file write -> blocked by size limit / tmpfs cap
- many open files, deep recursion, zombie children -> contained

**Failure and recovery suite** (`scripts/chaos/`):
- `kill -9` the worker mid-run -> lease expires -> job requeued -> another attempt completes; final result is from the new attempt.
- Partition simulation: worker keeps running but cannot heartbeat -> lease lost -> job runs elsewhere -> the stale worker's late result is rejected by fencing (`fenced_results_discarded_total` increments, stale S3 objects deleted).
- Exhaust `max_attempts` -> `DEAD_LETTERED`; admin requeue works.
- Postgres down: API returns `503` on writes and degraded reads from cache; recovers without restart; workers back off and resume.
- S3 down during upload: retries, job remains recoverable, no result is lost or double-counted.
- Redis down: rate limiting falls back to a conservative in-memory per-instance limit, SSE falls back to polling, caches bypassed, no request fails because of Redis alone.
- Kill the API mid write: reconciler fixes stuck `CREATED` rows.

**Smoke e2e**: Playwright login -> run Python -> see output.

## 16. Security requirements (summary, document in `docs/SECURITY.md`)

- Trust boundaries: (1) Internet to API, (2) control plane to worker plane, (3) worker agent to sandbox, (4) tenant to tenant. Describe the controls for each.
- Worker VMs: dedicated, private subnet, no inbound ports, outbound only to Postgres, Redis, S3. Block `169.254.169.254` from everything except the worker agent user via iptables and require IMDSv2 with hop limit 1 (setup script in `infra/worker-vm/`). Worker holds only an S3 role scoped to `tenants/*` get/put, not delete outside its attempt prefixes if feasible.
- Sandbox processes get no credentials, no env vars from the worker (explicit empty environment), no network.
- Helmet headers, strict CORS allowlist, body size limits, JSON only, zod on every input, parameterized SQL only.
- Secrets from environment or secret manager, never committed. Provide `.env.example`.
- Dependency audit step in CI. Patch cadence documented for kernel, nsjail and runtimes.
- State plainly in `docs/SECURITY.md`: Linux sandboxing is defense in depth, not an absolute guarantee. For hostile workloads at scale, consider gVisor or Firecracker microVMs (listed as future work).

## 17. Build phases (do them in order)

**Phase 0: Scaffold.** Monorepo, TypeScript configs, lint, format, CI workflow, `docker-compose.yml` (postgres, redis, minio + bucket init, api, worker, web), `.env.example`.
Done when: `docker compose up` starts all services and `/readyz` is green.

**Phase 1: Shared + DB.** `packages/shared` (schemas, states, languages), `packages/db` (migrations, repositories, claim SQL, `transitionExecution`), `packages/storage`.
Done when: migrations run clean; unit tests for the state machine and repositories pass.

**Phase 2: API write and read paths.** Auth, API keys, `POST /v1/executions`, reads, cancel, rate limiting, idempotency, cache, SSE, OpenAPI.
Done when: integration tests for sections 8, 10, 11 pass against a stub worker.

**Phase 3: Sandbox + Worker.** `packages/sandbox` (NsjailDriver first, DockerDriver second), rootfs builds, seccomp policy, worker loop, self-test.
Done when: the sandbox abuse suite passes on a Linux machine, and a Python and C job run end to end.

**Phase 4: Reliability.** Leases, heartbeats, fencing, reaper and reconciler, DLQ, retries with backoff, graceful shutdown, tenant concurrency and fairness.
Done when: the full failure and recovery suite passes.

**Phase 5: Frontend.** All pages in section 14.
Done when: Playwright smoke passes and the New Execution page shows live state changes.

**Phase 6: Admin, observability, ops.** Admin endpoints and pages, metrics, logs, worker VM setup scripts, runbook.
Done when: `/metrics` exposes all listed metrics and the runbook covers deploy, scale, DLQ handling, and each failure in section 15.

**Phase 7: Docs and polish.** `docs/ARCHITECTURE.md` (include a Mermaid diagram of the final system), `FAILURES.md` (failure matrix: failure, detection, recovery), `SECURITY.md`, `README.md` with a 5 minute quick start, seed script (admin + demo tenant + demo API key), a simple load test script.
Done when: a new developer can clone, run `docker compose up`, run the seed, open the UI and execute code within 5 minutes.

## 18. Assumptions (use these, do not ask)

- Single region, single Postgres primary with optional read replica, one Redis instance (no cluster).
- Workers are Linux VMs (Ubuntu 22.04+ or newer, kernel 5.15+, cgroup v2). Local development of the web, API and DB works on any OS; real nsjail sandboxing needs Linux.
- Max wall time 10s, default 5s. Default memory 256 MB, max 512 MB. Default 1 CPU. Max 64 processes. Output 1 MB per stream.
- Languages: Python, Node.js, C, C++.
- Delivery is at-least-once. Result authority is decided by `attempt` fencing.
- Email verification, password reset, billing, SSO, and multi-user invites are out of scope.
- Autoscaling is documented, not implemented.
- Local S3 is MinIO with path-style addressing; production S3 uses virtual-hosted style and SSE enabled; bucket is private.

## 19. Environment variables (put in `.env.example`)

```
NODE_ENV=development
API_PORT=3000
WEB_ORIGIN=http://localhost:5173
JWT_SECRET=change-me
DATABASE_URL=postgres://app:app@postgres:5432/engine
DATABASE_READ_URL=
REDIS_URL=redis://redis:6379
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=engine-artifacts
S3_ACCESS_KEY_ID=minio
S3_SECRET_ACCESS_KEY=minio12345
S3_FORCE_PATH_STYLE=true
RETENTION_DAYS=30
WORKER_ID=
WORKER_SLOTS=
LEASE_SECONDS=30
HEARTBEAT_SECONDS=5
DRAIN_SECONDS=30
SANDBOX_DRIVER=nsjail
SANDBOX_ROOTFS_DIR=/opt/sandbox/rootfs
NSJAIL_BIN=/usr/local/bin/nsjail
```
Validate all env vars with zod at startup and fail fast with a readable message.

## 20. Definition of done

- All phase "done when" checks pass.
- `docker compose up` plus seed gives a working system.
- Sandbox abuse suite and failure/recovery suite pass on Linux and results are summarized in `docs/TEST_REPORT.md`, including anything skipped and why.
- Docs exist and match what was actually built (no claims that the code does not back up).
- A final section in `docs/ARCHITECTURE.md` lists known limitations honestly.
