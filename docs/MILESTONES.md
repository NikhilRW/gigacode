# Milestones

Maps to Build-spec §17. A milestone is **done** only when its "done when" check has actually been run and passed.
The original milestones below track the web app and backend. The Expo Android/iOS/web port (`apps/expo`)
is installed separately with Bun; device and Codespaces setup is in [CODESPACES.md](CODESPACES.md).
These existing milestone checks do not establish physical-device or Codespaces runtime verification.
Evidence for every ✅ below is in [TEST_REPORT.md](TEST_REPORT.md).

| # | Milestone | Done when | Status |
|---|---|---|---|
| M0 | Scaffold | `docker compose up` starts all services, `/readyz` green | ✅ (CI workflow written, not yet run on GitHub) |
| M1 | Shared + DB | Migrations clean; state machine/repository tests pass | ✅ |
| M2 | API write + read paths | Integration tests for §8, §10, §11 pass with stub worker | ✅ 21/21 |
| M3 | Sandbox + worker | Abuse suite passes on Linux; Python and C run end to end | ✅ 15/15 abuse; all 4 languages end to end |
| M4 | Reliability | Failure/recovery suite passes | ✅ chaos 7/7 in one run |
| M5 | Web dashboard | Playwright smoke passes; live state via SSE | ✅ |
| M6 | Admin, observability, ops | All §13 metrics exposed; runbook complete | ✅ (worker-VM scripts not run on a real VM) |
| M7 | Docs + polish | Clone → compose up → seed → run code in 5 minutes | ✅ fresh clone to running code in 36 s with a warm cache; load test 60/60 |

## Remaining (outside the milestone checks)

1. Run the CI workflow on GitHub Actions.
2. Provision one real worker VM with `infra/worker-vm/setup.sh` and run the self-test and abuse suite there.
3. Time a cold-cache quick start on a clean machine.
