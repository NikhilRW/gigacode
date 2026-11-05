# Simulation lab (live tenant monitor + optional bounded jobs)

Open `/simulation` directly in the existing Expo Router app (or its corresponding app deep link). No navigation/configuration changes are required. **No POSTs or jobs on mount**: the focused, foreground screen automatically observes the authenticated tenant with read-only GETs. Start is optional. Use an authenticated **dedicated test tenant**, explicitly confirm authorization and isolation, then press **Start real workload** to consume real tenant quota and worker resources.

## Live architecture monitor

The horizontally scrollable architectural canvas follows Clients → API → Durable Job Queue → Worker Pool → Sandboxes → Results, with static Postgres, Redis and S3/MinIO dependencies. Connections describe the documented logical architecture, not individual traced requests. Every stage distinguishes measured tenant data from static/uninstrumented infrastructure.

Before Start, the observer sequentially requests `/v1/usage` and the latest eight `/v1/executions` approximately every 10 seconds, without overlapping cycles. Queued/running values describe **tenant executions**, not fleet workers, available slots or global queue depth. The latest results are a bounded sample, not all-time totals. CPU time and memory on execution rows are per-run values, never host utilization. A brief highlight marks a received usage snapshot, not network flow or a health check. Missing data remains unknown; data older than 25 seconds, paused data, errors and cooldowns are explicitly last known/unavailable.

Observation pauses off-screen/backgrounded and during preflight, production and draining; the active controller supplies tenant usage snapshots during the experiment instead. Reads use the existing authenticated client, including for configured remote targets that are blocked for load. Authorization failures halt passive retries until the observer/session is recreated. Other read failures retry no sooner than 10 seconds. Observer HTTP 429 shares the load controller's cooldown, blocking passive reads, Start preflight and cleanup requests until expiry. It never initiates jobs. API/authentication/tenant changes dispose the previous observer and invalidate its pending results.

## GitHub Codespaces browser target

Configure the existing Connection screen with the **API's HTTPS browser-forwarded origin**, e.g. `https://<workspace>-3000.app.github.dev`; open this app from another HTTPS forwarded port in the **exact same workspace**, e.g. `https://<workspace>-8081.app.github.dev/simulation`. These are examples, not port requirements. Forwarding, port access, API authentication and CORS must already permit the connection; this feature does not configure them. In a browser, `localhost` addresses the browser's computer, not the Codespace.

For load, both complete origins must use canonical lowercase `https://<workspace>-<port>.app.github.dev` hosts (port 1–65535). An optional trailing slash is accepted; credentials, explicit URL ports, paths, query strings, fragments, lookalike suffixes, mismatched workspaces and noncanonical forms are blocked. Codespaces load is blocked without a matching browser origin (including native apps). Type the **exact displayed normalized API origin**, without a trailing slash, as well as both attestations before Start. Changing target/controller invalidates previous consent. Host matching proves neither authorization, isolation nor safety: a same-workspace proxy can still target production.

## Guardrails

- Load allows canonical `http(s)://localhost`, `127.0.0.1`, or `[::1]` origins with optional valid ports, or the matching Codespaces browser target described above. LAN, emulator aliases, arbitrary remote/staging names, credentials, paths and noncanonical URL tricks are blocked. There is no authoritative staging allowlist. Loopback and same-workspace forwarding can still proxy production: the user must not configure such a proxy.
- Isolation is **user-attested**, not server-enforced. Preflight rechecks `/v1/me`, `/v1/usage`, tenant/user identity, the stricter reported limits and an empty running/queued backlog. This does not prevent concurrent activity from another client.
- Fixed Python checksum only: 20,000 iterations, small output, no imports/user-supplied code or stdin, network disabled, 1 s timeout, 64 MiB, CPU quota 100 ms/s, 16 PIDs. No infrastructure or scaling changes.
- 0.1–1 req/s, 5–60 seconds, at most 30 POST **attempts** (including failures), one create request in flight, at most two accepted nonterminal/in-flight jobs or the lower tenant concurrency cap. Tenant execution/minute limits also bound rate. Backpressure skips slots; it never catches up. Add load adds 0.1 req/s without increasing duration or budget. One experiment per mounted controller.
- POST creates and cancellations are never retried. Any submission/active-monitor failure stops production. An active-controller HTTP 429 stops production and pauses monitoring/cancellation for exposed Retry-After, otherwise 60 s; the current `ApiClient` does **not** expose that header. Production never automatically resumes. Two consecutive active-monitor errors (or lost authorization) halt active monitoring. Passive observation can resume after cooldown when no experiment is active.

## Stop and ambiguity

Stop, duration/cap exhaustion, backgrounding and leaving the route stop **new** submissions and request cancellation only for this controller's own returned IDs, using its captured client/origin/session. A successful cancel request is not a terminal status. While mounted, draining observes actual statuses for up to 90 seconds; stale terminal responses are not counted. Cancellation failures and unresolved IDs stay visible. No production traffic is sent to a newly selected origin. Changing API client, identity or authentication disposes the old controller and invalidates in-flight reads.

Creates are deliberately not aborted: their promises remain observed and late returned IDs receive best-effort cancellation, even after disposal. Timeouts, lost responses, invalid responses and 5xx may occur **after** server commit. Without an ID or client-supported idempotency/correlation, safe ownership recovery is impossible: the UI marks these submissions unknown, stops, does not retry, and directs the operator to reconcile the dedicated tenant in History. Disposal also emits credential-free cleanup warnings for in-flight/unknown submissions and failed cancellations. Never claim these jobs are confirmed stopped. Background suspension, process termination, expired/revoked credentials, and unavailable API can prevent cleanup; inspect History manually. This is not a server-managed load-test service.

## Metrics and verification

Experiment counts come only from this controller's POST attempts, returned IDs and fresh execution metadata, separately from tenant observations. “Completed” means SUCCESS; failures include FAILED/TIMEOUT/DEAD_LETTERED; cancellations and rejected/unknown submissions are separate. Observed throughput is terminal outcomes (including cancelled) divided by elapsed experiment/drain time. HTTP submission latency, poll-observed end-to-end latency (includes queue and polling delay), and API-reported execution `wallMs` are distinct. Tenant usage is contextual, not experiment-only. Output/results link to `/execution?id=…`. Worker count, host CPU/memory utilization, service health, whole-system capacity and autoscaling telemetry are not exposed; autoscaling is not implemented.

Mock-only verification (no actual workload or endpoint calls):

```sh
cd apps/expo
bun test tests/simulation.test.ts tests/simulation-monitor.test.ts
bunx --no-install tsc --noEmit --incremental false
bunx --no-install eslint src/app/simulation.tsx src/lib/simulation/controller.ts src/lib/simulation/api.ts src/lib/simulation/observer.ts src/lib/simulation/target.ts src/components/simulation/ArchitectureCanvas.tsx tests/simulation.test.ts tests/simulation-monitor.test.ts
```

Tests use deterministic clocks, deferred promises and mock transports; they do not contact a real API or worker. UI/live workload behavior is not manually verified by these commands. No dependencies, installs, original project file edits, live load tests or infrastructure changes are needed.
