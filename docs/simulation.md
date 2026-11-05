# Simulation lab (real, bounded jobs)

Open `/simulation` directly in the existing Expo Router app (or its corresponding app deep link). No navigation/configuration changes are required. Nothing is submitted on mount. Use an authenticated **dedicated test tenant** and explicitly confirm authorization and isolation, then press **Start real workload**. These jobs consume real tenant quota and worker resources.

## Guardrails

- Only canonical `http(s)://localhost`, `127.0.0.1`, or `[::1]` origins with optional ports are allowed. LAN, emulator aliases, remote/staging names, credentials, paths and noncanonical URL tricks are blocked. There is no authoritative staging allowlist in this implementation. Loopback can still proxy production: the user must not configure such a proxy.
- Isolation is **user-attested**, not server-enforced. Preflight rechecks `/v1/me`, `/v1/usage`, tenant/user identity, the stricter reported limits and an empty running/queued backlog. This does not prevent concurrent activity from another client.
- Fixed Python checksum only: 20,000 iterations, small output, no imports/user-supplied code or stdin, network disabled, 1 s timeout, 64 MiB, CPU quota 100 ms/s, 16 PIDs. No infrastructure or scaling changes.
- 0.1–1 req/s, 5–60 seconds, at most 30 POST **attempts** (including failures), one create request in flight, at most two accepted nonterminal/in-flight jobs or the lower tenant concurrency cap. Tenant execution/minute limits also bound rate. Backpressure skips slots; it never catches up. Add load adds 0.1 req/s without increasing duration or budget. One experiment per mounted controller.
- POST creates and cancellations are never retried. Any submission/monitor failure stops production. HTTP 429 stops production and pauses monitoring/cancellation for exposed Retry-After, otherwise 60 s; the current `ApiClient` does **not** expose that header. Production never automatically resumes. Two consecutive monitor errors (or lost authorization) halt monitoring.

## Stop and ambiguity

Stop, duration/cap exhaustion, backgrounding and leaving the route stop **new** submissions and request cancellation only for this controller's own returned IDs, using its captured client/origin/session. A successful cancel request is not a terminal status. While mounted, draining observes actual statuses for up to 90 seconds; stale terminal responses are not counted. Cancellation failures and unresolved IDs stay visible. No production traffic is sent to a newly selected origin. Changing API client, identity or authentication disposes the old controller and invalidates in-flight reads.

Creates are deliberately not aborted: their promises remain observed and late returned IDs receive best-effort cancellation, even after disposal. Timeouts, lost responses, invalid responses and 5xx may occur **after** server commit. Without an ID or client-supported idempotency/correlation, safe ownership recovery is impossible: the UI marks these submissions unknown, stops, does not retry, and directs the operator to reconcile the dedicated tenant in History. Disposal also emits credential-free cleanup warnings for in-flight/unknown submissions and failed cancellations. Never claim these jobs are confirmed stopped. Background suspension, process termination, expired/revoked credentials, and unavailable API can prevent cleanup; inspect History manually. This is not a server-managed load-test service.

## Metrics and verification

Experiment counts come only from tracked returned IDs and fresh execution metadata. “Completed” means SUCCESS; failures include FAILED/TIMEOUT/DEAD_LETTERED; cancellations and rejected/unknown submissions are separate. Observed throughput is terminal outcomes (including cancelled) divided by elapsed experiment/drain time. HTTP submission latency, poll-observed end-to-end latency (includes queue and polling delay), and API-reported execution `wallMs` are distinct. Tenant usage is contextual, not experiment-only. Output/results link to `/execution?id=…`. No invented global CPU, worker utilization, scaling, or global-capacity measurements.

Mock-only verification (no actual workload or endpoint calls):

```sh
bun test apps/expo/tests/simulation.test.ts
cd apps/expo
bunx --no-install tsc --noEmit --incremental false
bunx --no-install eslint src/app/simulation.tsx src/lib/simulation tests/simulation.test.ts
```

No dependencies, installs, existing file edits, or live load tests are needed.
