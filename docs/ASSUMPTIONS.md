# Assumptions and deviations

## From Build-spec §18 (adopted as written)

- Single region; a single Postgres primary with an optional read replica (`DATABASE_READ_URL`); one Redis instance, no
  cluster.
- Workers are Linux VMs (Ubuntu 22.04+, kernel 5.15+, cgroup v2). The web app, API and DB work on any OS; real nsjail
  sandboxing needs Linux.
- Wall time: maximum 10s, default 5s. Memory: default 256 MB, maximum 512 MB. Default one CPU, at most 64 processes,
  1 MB of output per stream.
- Languages: Python 3.12, Node.js 20, C (gcc 13) and C++17 (g++ 13).
- At-least-once delivery; result authority is decided by attempt fencing.
- Out of scope: email verification, password reset, billing, SSO and invites.
- Autoscaling is documented, not implemented.
- Local S3 is MinIO with path-style addressing. Production S3 is assumed to use virtual-hosted style, SSE and a private
  bucket.

## Added during the build

### Repository and tooling

- The pnpm workspace excludes `apps/expo`, the separately installed Bun-based Android/iOS/web client. The original
  web dashboard is `apps/web`. Expo uses the same backend through native user Bearer sessions; see
  [CODESPACES.md](CODESPACES.md) for device setup.
- The dev host runs Node 22; the images run Node 20 LTS (`node:20-bookworm-slim`). TypeScript runs through `tsx`, in
  dev and in the images.
- Docker Hub no longer serves `minio/minio`, so compose uses `cgr.dev/chainguard/minio:latest`. It is unpinned
  (latest is the only free tag). The bucket and lifecycle rule are created by `scripts/init-infra.ts` instead of an
  `mc` container.
- Compose maps Redis to host port **6380**, because the dev machine already has a native Redis on 6379. Host-side
  integration tests should use `REDIS_URL=redis://localhost:6380`.
- The browser bundle imports runtime values from `packages/shared/src/*` through a Vite alias (`@shared/*`), because
  `@engine/shared`'s index pulls in `node:crypto`.

### Extra environment variables

| Var | Purpose |
|---|---|
| `S3_PUBLIC_ENDPOINT` | Endpoint used when presigning log URLs for browsers. MinIO's compose hostname isn't reachable from a browser. |
| `COOKIE_SECURE` | Whether the session cookie is Secure. `false` for plain-http local dev. |
| `WORKER_DATABASE_URL`, `WORKER_DB_PASSWORD`, `WORKER_DB_LOGIN` | The worker's restricted login (a member of `worker_role`), created and updated by `scripts/init-infra.ts`. |
| `REAPER_INTERVAL_MS` | Reaper period, default 10000. |
| `CHAOS_DROP_HEARTBEATS` | Chaos testing only: the worker stops extending leases. Ignored when `NODE_ENV=production`. |
| `POLL_INTERVAL_MS`, `RUNS_DIR`, `WORKER_LANGUAGES`, `SANDBOX_SECCOMP_DIR` | Worker tuning and paths, with sensible defaults. |

### State machine and queue

- `DEAD_LETTERED` is reachable from `DISPATCHED`, `STARTING` and `RUNNING` (a lease expiring on the last attempt), as
  well as from `QUEUED`. The spec's transition table lists it only from `QUEUED`; the rules in §6 and §12 require the
  other paths.
- `DEAD_LETTERED → QUEUED` exists only for admin requeue. It sets `max_attempts = attempt + 3` rather than resetting
  `attempt`, because attempt numbers are part of the S3 result keys and of the unique `(execution_id, attempt)`
  constraint. Requeue also clears `failure_reason`.
- Worker transitions run in SECURITY DEFINER SQL functions (`worker_claim`, `worker_heartbeat`, `worker_advance` and
  `worker_complete`), not in the TypeScript `transitionExecution`, so `worker_role` needs no table privileges. API-side
  transitions all use `transitionExecution`.
- Completion is fenced on an unexpired lease (`lease_expires_at >= now()`) as well as owner and attempt, so a stale
  worker loses even before the reaper runs.
- `tenant_concurrency.last_dispatched_at` was added so claims can be fair across tenants.

### Sandbox

- `socket` and `socketpair` return EPERM instead of killing the process, so programs see a normal error. The network
  namespace has no interfaces in any case.
- `clone3`, io_uring, `pkey_*`, landlock and AIO return ENOSYS so runtimes fall back cleanly. `clone` is allowed only
  without `CLONE_NEW*` flags.
- Node also needs `memfd_create`, `getsockname`, `getpeername` and `getsockopt` (libuv probes its stdio fds).
  `socket()` stays denied.
- The per-run cgroup is created and owned by the worker. nsjail's own cgroup features are not used, so the worker can
  read the OOM, peak-memory and CPU statistics.
- Per-run directories are mode **0711**, not 0700. nsjail bind-mounts the workspace from inside the new user
  namespace, which needs search permission on the parent directories. Listing is still denied.
- Each slot maps the sandbox user (65534) to its own host uid (200000 + slot).
- RLIMIT_AS is 16 GB for Node (V8 reserves large virtual ranges) and 4×memory + 1 GB for other runtimes. cgroup
  `memory.max` is the effective limit.
- The self-test compiles C and C++ but does not run the binary. Compile plus run is covered by the abuse suite and the
  end-to-end runs.

### API behaviour

- SSE (`/events`) requires a dashboard session. API-key callers get 400 `session_required` and should poll.
- `POST /v1/api-keys` requires a session; API-key callers get 403.
- API-key callers have role `member`. `/v1/me` for them has an empty email, `user.id` set to the key id, and an empty
  `csrfToken`.
- During a Postgres outage, `GET /v1/executions/:id` serves a 1h stale copy (`exec:{tenant}:{id}:stale`) and adds
  `stale: true`.
- Logout requires the CSRF header only when a valid session cookie is present.
- Additional error codes: `email_taken`, `invalid_credentials`, `invalid_api_key`, `csrf_failed`, `source_too_large`
  (413), `queue_full` (429), `not_ready`, `not_cancellable`, `unsupported_media_type` (415), `limit_exceeded`,
  `forbidden` and `unavailable`.
- In production the API refuses to start if `JWT_SECRET` still starts with `change-me`.
- `/docs` serves the generated OpenAPI 3 JSON document; no Swagger UI page is bundled.
