# Code Execution Engine

A multi-tenant, sandboxed code execution platform. Clients submit Python, Node.js, C or C++ source plus limits,
through a REST API or a React dashboard.

- Jobs are queued in Postgres and run by workers inside **nsjail** sandboxes: Linux namespaces, cgroup v2, a
  seccomp-bpf allowlist, rlimits and no network.
- Results are stored in S3, and live status is streamed to the dashboard.

The isolation model is **layered isolation and resource containment**, not a guarantee; the host kernel stays in the
trusted computing base. See [docs/SECURITY.md](docs/SECURITY.md).

> `apps/expo` is a separate mobile prototype. It is currently deprioritized and not part of the pnpm workspace.

## Quick start (about 5 minutes)

Needs Docker with cgroup v2: Docker Desktop with WSL2, or Linux.

```sh
docker compose up -d --build                           # first build pulls the runtime images and builds nsjail
docker compose exec api pnpm --filter @engine/api seed # creates the admin, a demo tenant and a demo API key
```

Then open <http://localhost:5173> and log in:

| Account | Email | Password |
|---|---|---|
| Demo tenant | `demo@example.com` | `demo-password-123` |
| Platform admin | `admin@example.com` | `admin-password-123` |

Go to **New execution**, keep the Python starter, and press **Run** (or Ctrl/Cmd+Enter). You'll see the status move
through `QUEUED → DISPATCHED → STARTING → RUNNING → SUCCESS`, then stdout, exit code, wall time, CPU time and peak
memory.

To use the API directly, take the key printed by the seed, or create one under **API keys**:

```sh
KEY=ce_live_...
curl -s -X POST http://localhost:3000/v1/executions \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"language":"python","files":[{"path":"main.py","content":"print(6*7)"}],"entryFile":"main.py"}'
# -> {"id":"...","status":"QUEUED"}
curl -s http://localhost:3000/v1/executions/<id> -H "authorization: Bearer $KEY"
curl -s "http://localhost:3000/v1/executions/<id>/logs?stream=stdout&inline=true" -H "authorization: Bearer $KEY"
```

Other endpoints:
- Health: `GET /healthz` and `GET /readyz`.
- OpenAPI document: `GET /docs`.
- Prometheus metrics: `GET /metrics`, internal only and not proxied by the web container.

## Repository layout

```
apps/
  api/        Fastify control plane: auth, API keys, executions, SSE, admin, metrics, reaper
  worker/     Worker agent: claim, lease and heartbeat, sandbox run, fenced completion, self-test
  web/        React + Vite + Tailwind dashboard (Monaco editor)
  expo/       Mobile prototype (deprioritized, not in the workspace)
packages/
  shared/     zod schemas, state machine, languages, limits, S3/Redis key builders
  db/         SQL migrations, repositories, transitionExecution, PgJobQueue
  sandbox/    SandboxDriver, NsjailDriver, DockerDriver (dev only), abuse suite
  storage/    S3 wrapper
infra/
  docker-compose.yml, docker/   compose stack and Dockerfiles (api, worker, web, nginx)
  nsjail/seccomp/               kafel seccomp policies
  rootfs/                       per-language rootfs build scripts
  worker-vm/                    systemd unit, firewall, VM setup script
scripts/      init-infra, chaos suite, load test
docs/         architecture, security, failures, runbook, assumptions, milestones, test report
```

## Tests

```sh
pnpm install
npx vitest run --project unit                                  # state machine, validation, limits, hashing, mapping

# integration (Postgres, Redis and MinIO from compose; compose Redis is on host port 6380).
# The tests use a stub worker, so stop the real one first; they refuse to run otherwise.
docker compose stop worker
REDIS_URL=redis://localhost:6380 npx vitest run --project integration
docker compose start worker

# sandbox abuse suite (inside the Linux worker container)
docker compose exec worker sh -c 'cd /app/packages/sandbox && npx vitest run test/abuse'

# failure and recovery (chaos) suite, against the running stack after seeding
bash scripts/chaos/run-all.sh

# end-to-end smoke (Playwright, against http://localhost:5173)
cd apps/web && npx playwright install chromium && npx playwright test

# load test
API_KEY=ce_live_... pnpm loadtest
```

## Docs

- [Architecture](docs/ARCHITECTURE.md), including the system diagram and known limitations
- [Security](docs/SECURITY.md)
- [Failure matrix](docs/FAILURES.md)
- [Runbook](docs/RUNBOOK.md)
- [Assumptions and deviations](docs/ASSUMPTIONS.md)
- [Milestones](docs/MILESTONES.md)
- [Test report](docs/TEST_REPORT.md)
