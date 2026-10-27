# Milestones

Maps to Build-spec §17. A milestone is **done** only when its "done when" check has actually been run and passed.
Priority is the web app working end to end with the backend. The Expo mobile app (`apps/expo`) is out of scope for now
and is excluded from the pnpm workspace.

| # | Milestone | Done when | Status |
|---|---|---|---|
| M0 | Scaffold | `docker compose up` starts postgres, redis, minio, api, worker, web and `/readyz` is green | 🟡 Monorepo, TS/lint/format configs, compose, `.env.example` done. Full-stack `compose up` not yet verified. CI workflow missing. |
| M1 | Shared + DB | Migrations run clean; unit tests for state machine, validation, limits, hashing, backoff pass | ✅ Migrations applied (incl. `worker_role` + fenced SQL functions); 37 unit tests pass |
| M2 | API write + read paths | Integration tests for §8, §10, §11 pass against a stub worker | ✅ 21/21 integration tests pass (cross-tenant 404s, idempotency, 429, concurrency cap, cancel, worker_role denied table access) |
| M3 | Sandbox + worker | Abuse suite passes on Linux; Python and C jobs run end to end | 🔄 In progress. nsjail 3.4 image built, config fields verified against `config.proto`; seccomp (kafel) policy being fixed; abuse suite written, not yet run |
| M4 | Reliability | Failure/recovery suite (`scripts/chaos/`) passes | 🟡 Leases, heartbeats, fencing (incl. lease-expiry fence), reaper, DLQ, backoff, graceful drain implemented. Chaos scripts not written |
| M5 | Web dashboard | Playwright smoke passes; New Execution shows live state via SSE | 🟡 All §14 pages built; typecheck + build pass. Smoke test not yet run against the stack |
| M6 | Admin, observability, ops | `/metrics` exposes all §13 metrics; runbook covers deploy, scale, DLQ, every §15 failure | 🟡 Admin API + pages, metrics, worker-VM scripts done. Runbook not written; metrics not yet verified by scrape |
| M7 | Docs + polish | New dev: clone → `docker compose up` → seed → run code in the UI within 5 minutes | ⬜ ARCHITECTURE, SECURITY, FAILURES, RUNBOOK, ASSUMPTIONS, TEST_REPORT, README, seed and load-test scripts pending |

## Order from here

1. **M3**: fix the seccomp policy, pass the worker self-test, and run the abuse suite in the worker container.
2. **M0 / M5**: run the full stack with `docker compose up`, then run the Playwright smoke test (register, run Python, see output).
3. **M4**: write the chaos scripts and run them: kill -9 the worker, simulate a partition, exhaust attempts into the DLQ, take Postgres, S3 and Redis down, kill the API mid-write.
4. **M6 / M7**: write the runbook, the docs, the seed and load-test scripts, the test report and the CI workflow.

## Known environment notes

- A native Windows Redis 3.0 is listening on host port 6379. Host-side tests reach it instead of the compose Redis 7; containers are unaffected.
- Docker Hub no longer serves `minio/minio`; compose uses `cgr.dev/chainguard/minio` (latest only, cannot be pinned on the free tier).
