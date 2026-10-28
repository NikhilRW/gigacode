# Test Report

Environment: Windows 11 dev host, Docker Desktop (WSL2 kernel 6.18, cgroup v2), Node 22 on host, Node 20 in images.
The sandbox runs under real nsjail 3.4 inside a privileged worker container (`infra/docker/worker.Dockerfile`).

## Verified

| Suite | Command | Result |
|---|---|---|
| Unit (shared, worker, api) | `npx vitest run --project unit` | ✅ 37 passed |
| API integration (real Postgres, Redis 7, MinIO; stub worker over `worker_login`) | `docker compose stop worker && REDIS_URL=redis://localhost:6380 npx vitest run --project integration` | ✅ 21/21 passed. With a real worker attached the suite refuses to run, with a clear message |
| Worker self-test | `pnpm --filter @engine/worker selftest` (in worker container; also runs at every worker start) | ✅ hello world for python, node, c, cpp (c/cpp: compile only); network egress blocked; fork bomb contained |
| Sandbox abuse suite | `cd packages/sandbox && npx vitest run test/abuse` (in worker container) | ✅ 15/15: timeout, OOM, fork bomb, network (1.1.1.1, host 127.0.0.1:5432, 169.254.169.254), host files hidden, read-only rootfs, seccomp kill for mount/ptrace/unshare/keyctl/bpf, 1 GB stdout truncated at 1 MB, large writes blocked, fd exhaustion/deep recursion/zombies contained, no leftover run cgroups |
| Failure and recovery suite | `bash scripts/chaos/run-all.sh` | ✅ 7/7 in one run (see below) |
| End to end through the API | `curl` | ✅ python, node, c, cpp → SUCCESS with correct stdout; infinite loop → TIMEOUT; invalid C → FAILED `compile_error` with gcc output |
| Web smoke (Playwright) | `cd apps/web && npx playwright test` | ✅ 1 passed (register → run Python → live status → stdout) |
| Load test | `API_KEY=... pnpm loadtest -- --clients 10 --jobs 60` | ✅ 60/60 SUCCESS, 10.2 jobs/s, end-to-end p50 906 ms / p90 976 ms / p99 1233 ms (2 worker slots, tenant max_concurrent 4, max_exec_per_min raised to 600 via admin API) |
| Fresh-clone quick start | `git clone`, `docker compose up -d --build`, seed, README curl, Playwright | ✅ ready in 36 s **with a warm Docker build cache**; a cold machine also pulls about 2 GB of images (gcc:13 is the largest), so expect several minutes on first run |
| Metrics | `curl localhost:3000/metrics` | ✅ all 15 metrics from spec §13 present |
| Typecheck / lint | `pnpm typecheck`, `npx eslint .` | ✅ clean |

### Chaos suite detail (single run)

| Scenario | Result |
|---|---|
| kill_worker: `kill -9` the worker mid-run | ✅ lease expired → requeued → attempt 2 SUCCESS |
| partition: worker stops heartbeating (`CHAOS_DROP_HEARTBEATS`, 4 s lease) | ✅ stale completion fenced (`fenced_results_discarded_total` +1, stale S3 objects deleted); another worker produced the final result |
| dlq: exhaust `max_attempts` | ✅ DEAD_LETTERED after 3 attempts; admin requeue → SUCCESS |
| postgres_down | ✅ write → 503, cached read → 200, recovered without restarts |
| s3_down: MinIO stopped for 15 s during the run/upload | ✅ worker upload retries outlasted the outage; exactly one authoritative result |
| redis_down | ✅ submit, run and read all worked with Redis stopped |
| api_crash: stuck CREATED rows | ✅ missing source → FAILED `artifact_missing`; uploaded source → requeued and completed |

### Bugs found by these suites and fixed

- **Chaos overlay:** `extends` without `file:` made every compose command in the script fail silently, so no faults were injected. The script now validates the compose config before running.
- **Reaper stall:** the reaper stalled for about 9 minutes behind an S3 request with no timeout. The S3 client now has connection and request timeouts, each reaper pass has a 60 s watchdog, and the worker's Redis client has a command timeout.
- **Wake-up hint:** a `queue:wake` hint woke only one idle worker slot. It now wakes all of them.

## Not verified

| Item | Status |
|---|---|
| CI workflow (`.github/workflows/ci.yml`) | Written, never run on GitHub Actions |
| Worker VM scripts (`infra/worker-vm/`) | Written, not run on a real VM (IMDSv2 hop limit is documented, not automated) |
| Cold-cache 5-minute quick start | Only measured with a warm build cache |
