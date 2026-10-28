# Failure matrix

Delivery is at least once, and attempt fencing decides which result is authoritative. Tests marked *chaos* are the
scenarios in `scripts/chaos/run-all.sh`; *int* is `apps/api/test/*.int.test.ts`; *abuse* is
`packages/sandbox/test/abuse/abuse.test.ts`; *unit* is `apps/worker/test/result-mapping.unit.test.ts`.

| Failure | Detection | Recovery | Test |
|---|---|---|---|
| Worker process crashes (`kill -9`) mid-run | Heartbeats stop and `lease_expires_at` passes. The reaper finds active rows with an expired lease. | Back to `QUEUED` with backoff (5s, 20s, 60s), keeping the attempt count. Another slot claims it as attempt n+1. `lease_expirations_total` increments. | chaos `kill_worker` |
| Partition / stale worker (keeps running, can't heartbeat) | Heartbeat returns 0 rows (lease lost) and the slot aborts the sandbox. If it can't reach the DB at all, the lease simply expires. | The reaper requeues and the job runs elsewhere. If the stale worker then tries to complete, `worker_complete` returns false, because the lease owner and attempt don't match or the lease has expired. The worker deletes its `attempts/{n}/` objects and increments `fenced_results_discarded_total`. | chaos `partition`; int (stale `complete()` returns false) |
| Lease expiry (slow DB, GC pause) | Same as above. | Same as above. Completion requires `lease_expires_at >= now()`, so an expired lease never wins even before the reaper runs. | int, chaos |
| Max attempts exhausted | The reaper sees an expired lease with `attempt >= max_attempts`. | `DEAD_LETTERED` (`failure_reason=max_attempts_exceeded`), and `dead_lettered_total` increments. An admin requeues it from the Admin UI or with `POST /v1/admin/dlq/:id/requeue`, which sets `QUEUED`, `max_attempts = attempt + 3` and clears `failure_reason`. | chaos `dlq`; int |
| Postgres down | `/readyz` 503; `db_errors_total`; worker claim errors. | API writes return 503 `unavailable`. `GET /v1/executions/:id` serves the last cached copy (`stale: true`). Workers back off with jitter and resume. The pg pool reconnects without a restart. | chaos `postgres_down` |
| Redis down | `/readyz` 503 on Redis; `redis_errors_total`. | Rate limiting falls back to an in-memory bucket at half the rate per instance. Caches are bypassed. SSE falls back to 2s DB polling. Workers rely on polling. No request fails because of Redis alone. | chaos `redis_down` |
| S3 down during the API write | Upload retries fail; `s3_errors_total`. | `CREATED → FAILED` (`artifact_upload_failed`) and the client gets 503 and can resubmit. | — (code path only) |
| S3 down during the worker's result upload | Upload retries (6 tries) fail. | The worker stops heartbeating and leaves the job; the lease expires and the job is retried. Result keys are per attempt and only the completing attempt's `result_prefix` is recorded, so nothing is lost or double counted. | chaos `s3_down` |
| S3 or source missing when the worker starts | Manifest or file download fails, or the checksum doesn't match. | Treated as an infrastructure failure: no completion, so lease expiry leads to a retry and eventually the DLQ. | — |
| API crashes mid-write (after insert, before `QUEUED`) | The reconciler finds `CREATED` rows older than 60s. | If the manifest exists, `QUEUED`; otherwise `FAILED` (`artifact_missing`). | chaos `api_crash` |
| Sandbox setup error (nsjail config, missing rootfs, cgroup) | nsjail never logs `Executing`, or cgroup creation fails. | `FAILED` with `sandbox_setup_error`. The worker self-test refuses to start when the environment is unsuitable. | unit; self-test |
| User code: timeout | nsjail logs `run time >= time limit`, or the watchdog fires. | `TIMEOUT` | abuse; e2e |
| User code: out of memory | `memory.events` shows `oom_kill > 0`. | `FAILED` with `oom` | abuse |
| User code: seccomp violation | Child killed by SIGSYS. | `FAILED` with `seccomp_violation` | abuse |
| User code: signal or non-zero exit | Exit code above 128 is a signal; otherwise the exit code. | `FAILED` with `killed_by_signal` or `runtime_error` | abuse; unit |
| User code: compile error | The compile step exits non-zero. | `FAILED` with `compile_error`; the compiler output is the job's stderr. | unit; e2e |
| Output flood / huge files / fd exhaustion | Byte caps, fsize rlimit, tmpfs size, nofile rlimit. | Output is truncated (`*_truncated=true`), writes fail with EFBIG or ENOSPC, and the job still finishes. | abuse |
| `tenant_concurrency` counter drift | The reaper recomputes it from active rows every pass. | Corrected and logged with the before and after values. | — (code path only) |
| Dead worker rows | No `last_heartbeat_at` for 30s. | Marked `dead`; its jobs recover through lease expiry. | — (code path only) |
| Retention | Terminal executions older than `RETENTION_DAYS`. | The reaper deletes the S3 prefix and the row. The S3 lifecycle rule (`RETENTION_DAYS + 1` days on `tenants/`) is the backstop. | — |
| Worker shutdown (scale-in, deploy) | SIGTERM | Drain: stop claiming, mark `draining`, wait up to `DRAIN_SECONDS`, then kill the remaining sandboxes. Those jobs recover through lease expiry. | manual |
