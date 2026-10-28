# Milestones

Maps to Build-spec §17. A milestone is **done** only when its "done when" check has actually been run and passed.
Priority is the web app working end to end with the backend. The Expo mobile app (`apps/expo`) is deprioritized and
excluded from the pnpm workspace. Evidence for every ✅ is in [TEST_REPORT.md](TEST_REPORT.md).

| # | Milestone | Done when | Status |
|---|---|---|---|
| M0 | Scaffold | `docker compose up` starts all services, `/readyz` green | ✅ Verified (CI workflow written but not run) |
| M1 | Shared + DB | Migrations clean; state machine/repository tests pass | ✅ |
| M2 | API write + read paths | Integration tests for §8, §10, §11 pass with stub worker | ✅ 21/21 |
| M3 | Sandbox + worker | Abuse suite passes on Linux; Python and C run end to end | ✅ 15/15 abuse; all 4 languages end to end |
| M4 | Reliability | Failure/recovery suite passes | ❌ Code implemented and covered by API integration tests; chaos suite written but **not passing / not completed** (see TEST_REPORT) |
| M5 | Web dashboard | Playwright smoke passes; live state via SSE | ✅ |
| M6 | Admin, observability, ops | All §13 metrics exposed; runbook complete | ✅ Metrics verified; runbook written. Worker-VM scripts not run on a real VM |
| M7 | Docs + polish | Clone → compose up → seed → run code in 5 minutes | 🟡 Docs, seed, and README quick start done, and the quick-start path worked in this session. Load test not run |

## Next (when resumed)

1. Start Docker, `docker compose up -d --build`, seed, then `bash scripts/chaos/run-all.sh kill_worker`, and debug why the fault isn't injected before the job finishes. Likely fix: use a longer job, or kill on `DISPATCHED`/`STARTING` instead of `RUNNING`. Then run the remaining scenarios one at a time.
2. Run the load test and the CI workflow.
