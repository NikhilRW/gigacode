# Runbook

## Deploy

### Local / dev (docker compose)

```sh
docker compose up -d --build                         # postgres, redis, minio, migrate (init), api, worker, web
docker compose exec api pnpm --filter @engine/api seed
curl localhost:3000/readyz                           # {"status":"ready","postgres":"ok","redis":"ok","s3":"ok"}
open http://localhost:5173
```

- The `migrate` service runs `scripts/init-infra.ts`: SQL migrations, the worker login role (`WORKER_DB_PASSWORD`),
  the S3 bucket, and the lifecycle rule.
- The dev worker runs privileged with `cgroup: private` so nsjail can work inside Docker Desktop. **Do not use this
  layout in production.**

### Production

- **API:** run N stateless instances behind a TLS-terminating reverse proxy or load balancer.
  - Proxy `/v1`, `/healthz`, `/readyz` and `/docs`. Never expose `/metrics` publicly; scrape it from inside the network.
  - Disable proxy buffering for `/v1/executions/*/events`, which is SSE.
  - Set `NODE_ENV=production`, a strong `JWT_SECRET`, `COOKIE_SECURE=true`, and `WEB_ORIGIN` set to the dashboard
    origin.
  - Run `scripts/init-infra.ts` once per release, before rolling out the new API.
  - The reaper runs on exactly one instance at a time, through a Postgres advisory lock, so no extra coordination is
    needed.
- **Web:** serve the static build (`infra/docker/web.Dockerfile`), or the same files from a CDN with the API on the
  same origin.
- **Worker VMs:** Ubuntu 22.04+, kernel 5.15+, cgroup v2, in a private subnet.

  ```sh
  git clone <repo> /opt/engine && cd /opt/engine
  sudo install -m 600 /dev/null /etc/engine-worker/env   # then fill in from .env.example (WORKER_DATABASE_URL, S3_*, REDIS_URL, NODE_ENV=production)
  sudo PG_CIDR=10.0.1.0/24 REDIS_CIDR=10.0.2.0/24 S3_CIDR=<vpc-endpoint-cidr> infra/worker-vm/setup.sh
  ```

  `setup.sh` does the following:
  - builds the pinned nsjail
  - builds each rootfs (`infra/rootfs/build-rootfs.sh`)
  - mounts a 4 GB tmpfs at `/var/lib/worker/runs`
  - applies the sysctls and the egress firewall
  - installs the `engine-worker` systemd unit, whose `ExecStartPre` runs the self-test

  It cannot set IMDSv2 itself. Do that with the cloud API (`--http-tokens required --http-put-response-hop-limit 1`).

## Scaling

Autoscaling is not implemented in code. Drive it from the metrics:

| Signal | Suggested rule |
|---|---|
| `queue_depth / sandbox_slots_total` | Scale out workers when above 2 for 2 minutes; scale in when below 0.25 for 10 minutes. |
| `oldest_queued_age_seconds` | Scale out when above 10s for 1 minute, whatever the depth. |
| `sandbox_slots_busy / sandbox_slots_total` | Keep it under 0.8 at steady state. |
| API CPU / `http_request_duration_seconds` p95 | Scale out API instances (HPA on CPU at 70%). |

- **AWS ASG:** publish these as CloudWatch metrics (a Prometheus exporter or CloudWatch agent), and use target
  tracking on queued jobs per slot.
- **Kubernetes:** an HPA on external metrics (prometheus-adapter) for a worker Deployment. The nodes must provide
  cgroup v2 delegation and allow the worker pod enough privilege to run nsjail.
- **Scale-in:** the instance gets SIGTERM, the worker stops claiming, is marked `draining`, and waits up to
  `DRAIN_SECONDS` (default 30). Remaining sandboxes are killed and those jobs recover through lease expiry. Set the
  ASG lifecycle hook or the pod's `terminationGracePeriodSeconds` to at least `DRAIN_SECONDS + 15`.
- `WORKER_SLOTS` defaults to the number of CPU cores. Each slot runs at most one core (`cpu.max`) and 512 MB.

## Dead-letter queue

1. Admin UI → **Dead letters** tab, or `GET /v1/admin/dlq` as a `platform_admin`.
2. Investigate the cause first: worker logs for that `executionId`, `execution_events` and the attempts table. A DLQ
   entry means 3 infrastructure failures, never a user error.
3. Requeue with the UI button or `POST /v1/admin/dlq/:id/requeue` (session plus `x-csrf-token`). This sets `QUEUED`,
   `max_attempts = attempt + 3`, and clears the failure reason.
4. If many jobs dead-letter at once, look for worker-wide problems first: S3 credentials, rootfs, disk, a self-test
   regression.

## Failure playbook (Build-spec §15)

| Situation | Symptoms / metrics | Actions |
|---|---|---|
| Worker killed or crashed | `workers.status=dead` after 30s; `lease_expirations_total` rising | Nothing for jobs: they requeue automatically. Restart the worker with systemd (`Restart=always`) and check its logs for the cause. |
| Network partition / stale worker | `fenced_results_discarded_total` increasing; lease-lost warnings in worker logs | Usually transient. If it persists, check that worker's network to Postgres. Results are protected by fencing, so no data fix is needed. |
| Attempts exhausted | `dead_lettered_total` increasing | See the DLQ section above. |
| Postgres down | `/readyz` 503; `db_errors_total`; API 503 on writes | Restore Postgres or fail over. The API and workers reconnect without a restart. Check `queue_depth` afterwards. |
| S3 down | `s3_errors_total`; submits return 503 (`artifact_upload_failed`); jobs requeue after worker upload failures | Restore S3. Jobs whose result upload failed are retried. Clients whose submit got a 503 must resubmit (the `Idempotency-Key` makes this safe). |
| Redis down | `redis_errors_total`; `/readyz` reports Redis down | No user impact beyond slower SSE (polling) and the per-instance fallback rate limit. Restore Redis. |
| API killed mid-write | `CREATED` rows older than 60s | The reconciler fixes them within one pass (10s): `QUEUED`, or `FAILED` with `artifact_missing`. |
| Sandbox self-test fails on a worker | The worker exits with code 2 and systemd keeps restarting it | Run `pnpm --filter @engine/worker selftest` by hand. Check the nsjail version, cgroup v2 delegation (`Delegate=yes`), the rootfs directories, and kernel changes. For seccomp kills, check `dmesg` for `audit … syscall=N`. |
| Many `seccomp_violation` failures after a runtime update | `failure_reason=seccomp_violation` spikes | Find the syscall with `dmesg`, add it to `infra/nsjail/seccomp/*.kafel` if it is safe, then rerun the abuse suite. |

## Test suites

```sh
# Chaos / failure-recovery suite (stack running, seed done)
bash scripts/chaos/run-all.sh                 # all scenarios
bash scripts/chaos/run-all.sh kill_worker dlq # subset: kill_worker partition dlq postgres_down s3_down redis_down api_crash

# Sandbox abuse suite (needs the Linux worker container)
docker compose exec worker sh -c 'cd /app/packages/sandbox && npx vitest run test/abuse'

# Self-test only
docker compose exec worker pnpm --filter @engine/worker selftest
```

The chaos suite uses `infra/docker-compose.chaos.yml`, which adds a `worker-chaos` service with
`CHAOS_DROP_HEARTBEATS=true` and a 4s lease. That flag is ignored when `NODE_ENV=production`.

## Secret rotation

- **`JWT_SECRET`:** deploy the new value to every API instance. Existing sessions become invalid and users log in
  again. API keys are unaffected.
- **Worker DB password:** set the new `WORKER_DB_PASSWORD` and rerun `scripts/init-infra.ts` (it runs `ALTER ROLE`).
  Update `WORKER_DATABASE_URL` on the workers and restart them one at a time. Running jobs recover through lease
  expiry.
- **API keys:** tenants revoke and recreate their keys in the dashboard. Revocation takes effect immediately because
  the Redis cache is invalidated.
- **S3 credentials:** rotate in the IAM or secret manager, update the env, and restart the API, then the workers.

## Metrics (`GET /metrics`)

`http_requests_total`, `http_request_duration_seconds`, `executions_created_total`,
`executions_finished_total{status}`, `queue_depth`, `oldest_queued_age_seconds`, `sandbox_slots_busy`,
`sandbox_slots_total`, `lease_expirations_total`, `dead_lettered_total`, `fenced_results_discarded_total`,
`rate_limited_total`, `s3_errors_total`, `db_errors_total` and `redis_errors_total`, plus the prom-client default
process metrics.

Notes:
- `queue_depth` and `oldest_queued_age_seconds` are computed at scrape time from Postgres.
- The slot gauges are summed from the Redis `worker:*` liveness keys.
- `fenced_results_discarded_total` is read from a Redis counter that workers increment.
