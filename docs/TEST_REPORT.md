# Test Report

Environment: Windows 11 dev host, Docker Desktop (WSL2 kernel 6.18, cgroup v2), Node 22 on host, Node 20 in images.
The sandbox ran under real nsjail 3.4 inside a privileged worker container (`infra/docker/worker.Dockerfile`).

## Verified

| Suite | Command | Result |
|---|---|---|
| Unit (shared, worker, api) | `npx vitest run --project unit` | ✅ 37 passed |
| API integration (real Postgres, Redis, MinIO; stub worker over `worker_login`) | `REDIS_URL=redis://localhost:6380 npx vitest run --project integration` | ✅ 21/21 passed. Note: these ran against host port 6379, which on this machine is a native Redis 3.0, not the compose Redis 7 |
| Worker self-test | `pnpm --filter @engine/worker selftest` (in worker container) | ✅ hello world for python, node, c, cpp (c/cpp: compile only); network egress blocked; fork bomb contained |
| Sandbox abuse suite | `cd packages/sandbox && npx vitest run test/abuse` (in worker container) | ✅ 15/15: timeout, OOM, fork bomb, network (1.1.1.1, host 127.0.0.1:5432, 169.254.169.254), host files hidden, read-only rootfs, seccomp kill for mount/ptrace/unshare/keyctl/bpf, 1 GB stdout truncated at 1 MB, large writes blocked, fd exhaustion/deep recursion/zombies contained, no leftover run cgroups |
| End to end through the API (compose stack) | `curl` script | ✅ python, node, c, cpp → SUCCESS with correct stdout; infinite loop → TIMEOUT; invalid C → FAILED `compile_error` with gcc output in stderr |
| Web smoke (Playwright) | `cd apps/web && npx playwright test` | ✅ 1 passed (register → run Python → live status → stdout shown) |
| Metrics | `curl localhost:3000/metrics` | ✅ all 15 metrics from spec §13 present |
| Typecheck / lint | `pnpm typecheck`, `npx eslint .` | ✅ clean |

## Not verified

| Suite | Status |
|---|---|
| Failure and recovery suite (`scripts/chaos/run-all.sh`) | ❌ **Not passing / not completed.** First run: the script drove a different compose project than the running stack (script bug, since fixed by giving the root compose file and the script the same project name, `code-exec-engine`). Second run: interrupted when the session and Docker Desktop stopped. Its partial output showed `kill_worker` and `partition` jobs finishing on attempt 1, so the faults were not actually injected in time. This needs investigation before any recovery claim is made. `dlq`, `postgres_down`, `s3_down`, `redis_down`, `api_crash`: no valid result. |
| Fencing / lease expiry / DLQ requeue | Covered at the API integration level (stale `complete()` returns false, reaper requeues and dead-letters, admin requeue). Not yet demonstrated against real workers. |
| CI workflow (`.github/workflows/ci.yml`) | Written, never run. |
| Load test (`scripts/loadtest.ts`) | Written, never run. |
| Worker VM scripts (`infra/worker-vm/`) | Written, not run on a real VM. |
