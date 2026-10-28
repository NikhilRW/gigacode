# GigaCode: Code Execution Engine

A multi-tenant platform for running untrusted code. You submit Python, Node.js, C or C++ source plus limits, from a
web dashboard or a REST API. A worker runs it inside a Linux sandbox and returns the output, exit status, timing and
memory use.

- Jobs are queued in Postgres and run by workers inside **nsjail** sandboxes: Linux namespaces, cgroup v2, a
  seccomp-bpf allowlist, rlimits and no network.
- Source and results are stored in S3. Postgres holds metadata only.
- The dashboard shows live progress and explains failures in plain words (timeout, out of memory, compile error).
- Workers can crash or lose their connection mid-run; the platform detects it and retries safely.

The isolation model is **layered isolation and resource containment**, not a guarantee. The host kernel stays in the
trusted computing base. See [docs/SECURITY.md](docs/SECURITY.md).

> `apps/expo` is a separate mobile prototype. It is deprioritized and not part of the pnpm workspace.

**Contents:** [Setup guide](#setup-guide) · [Walkthrough](#walkthrough) · [Using the API](#using-the-api) ·
[Repository layout](#repository-layout) · [Tests](#tests) · [Troubleshooting](#troubleshooting) · [Docs](#docs)

---

## Setup guide

### 1. What you need

| Requirement | Notes |
|---|---|
| **Docker** with Compose v2 | Developed and tested on Windows 11 with Docker Desktop (WSL2 backend). Linux with Docker Engine should work the same way but has not been tried here. macOS has not been tried. |
| **cgroup v2** | Needed by the sandbox. Docker Desktop with WSL2 and any current Linux distribution have it. The worker self-test tells you if it is missing. |
| About **5 GB** of free disk, and a few GB of RAM for Docker | The worker image alone is 2.7 GB (three language runtimes). The RAM figure is a guideline, not a measured minimum. |
| Free ports | `5173` web, `3000` API, `5432` Postgres, `6380` Redis, `9000` and `9001` MinIO. |

Node.js and pnpm are **not** needed just to run the app. You only need them to run the tests or to develop the
dashboard (Node 20 or newer, pnpm 10).

The sandbox only works on Linux. On Windows (and macOS) the worker runs inside Docker's Linux VM, so nothing extra is required.

### 2. Start it

```sh
git clone <this repository> gigacode
cd gigacode
docker compose up -d --build
```

The first build takes several minutes (it builds nsjail and unpacks three language runtimes). Later starts take well
under a minute. When it settles:

```sh
docker compose ps                  # api, worker, web, postgres, redis, minio should be Up; migrate shows Exited (0)
curl -s http://localhost:3000/readyz
# {"status":"ready","postgres":"ok","redis":"ok","s3":"ok"}
```

On start the worker runs a **self-test** (hello world in every language, a blocked-network probe, a fork-bomb probe)
and only starts taking jobs if it passes. Check with `docker compose logs worker`; you want `self-test passed` and
`claiming jobs`.

### 3. Create the demo accounts

```sh
docker compose exec api pnpm --filter @engine/api seed
```

It prints the accounts below and a demo API key (shown once). Running it again is safe; it does not duplicate anything.

| Account | Email | Password |
|---|---|---|
| Demo tenant | `demo@example.com` | `demo-password-123` |
| Platform admin | `admin@example.com` | `admin-password-123` |

These are development defaults. Change them with `SEED_ADMIN_PASSWORD` and `SEED_DEMO_PASSWORD`, and never use them
anywhere reachable from a network you don't control.

### 4. Open the app

| What | Where |
|---|---|
| Dashboard | <http://localhost:5173> |
| API | <http://localhost:3000> (health `/readyz`, OpenAPI `/docs`, metrics `/metrics`) |
| MinIO console (stored files) | <http://localhost:9001>, login `minio` / `minio12345` |

Sign in as the demo user, open **Playground**, press **Run**. If you see output, everything works end to end.
Continue with the [walkthrough](docs/WALKTHROUGH.md).

### 5. Everyday commands

```sh
docker compose up -d                 # start (images already built)
docker compose logs -f worker api    # follow logs
docker compose stop                  # stop, keep data
docker compose down                  # remove containers, keep data (volumes)
docker compose down -v               # remove everything, including the database and stored files
docker compose up -d --build web     # rebuild one service after changing its code
```

Services restart automatically unless you stopped them.

### 6. Configuration

Defaults work out of the box for local use. All settings are environment variables, validated at startup with a
readable error if something is wrong. See [`.env.example`](.env.example) for the full list. The ones you are most
likely to change:

| Variable | Default | Meaning |
|---|---|---|
| `JWT_SECRET` | dev value | Signs session cookies. **Set a long random value anywhere real.** In production the API refuses to start if it still begins with `change-me` (the placeholder in `.env.example`). |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS. |
| `WEB_ORIGIN` | `http://localhost:5173` | The only browser origin allowed by CORS. |
| `WORKER_SLOTS` | CPU count (2 in compose) | How many jobs one worker runs at once. |
| `LEASE_SECONDS` / `HEARTBEAT_SECONDS` | `30` / `5` | How quickly a lost worker's job is retried. |
| `RETENTION_DAYS` | `30` | Finished runs and their files are deleted after this long. |
| `SANDBOX_DRIVER` | `nsjail` | `docker` is a weaker, development-only fallback and is refused in production. |

Per-workspace limits (concurrency, runs per minute, max time, max memory, source size) are edited by a platform admin
under **Admin → Platform → Tenants and limits**.

### 7. Developing the dashboard

Keep the stack running with Docker as above, but stop its web container so the dev server can use port 5173:

```sh
pnpm install
docker compose stop web
pnpm --filter @engine/web dev        # http://localhost:5173 with hot reload
```

Vite proxies `/v1` to the API on `localhost:3000`. To work on the API or worker outside Docker, see
[docs/RUNBOOK.md](docs/RUNBOOK.md).

### 8. Production

The compose file is for development. For a real deployment: run workers on dedicated Linux VMs with
[`infra/worker-vm/setup.sh`](infra/worker-vm/setup.sh) (firewall, systemd unit, rootfs builds), put the API behind a
TLS reverse proxy, and use managed Postgres, Redis and S3. See [docs/RUNBOOK.md](docs/RUNBOOK.md) and
[docs/SECURITY.md](docs/SECURITY.md).

---

## Walkthrough

The full guided tour is in **[docs/WALKTHROUGH.md](docs/WALKTHROUGH.md)**. The short version:

1. **Sign in** as `demo@example.com`, or create your own workspace at `/register`.
2. **Overview** shows live activity and a three-step setup checklist that ticks itself off as you use the product.
3. **Playground**: write code, press **Run** (Ctrl/⌘ + Enter), and watch *Queued → Starting → Running → Done*. You get
   output, exit code, wall and CPU time and peak memory.
4. **Break it on purpose** with the ready-made snippets in the walkthrough: an infinite loop gives "Timed out after
   1.00 s", a memory hog gives "Ran out of memory (64 MB limit)", a C syntax error opens the compiler output, and a
   network call is blocked.
5. **Runs** lists everything you have run. Open a run to see its timeline and attempts, re-run it, or cancel it.
6. **API keys**: create a key (shown once) and call the REST API with `curl`.
7. **Admin** (as `admin@example.com`): workers, queue depth, dead-lettered runs, and per-workspace limits.
8. **Recovery**: kill the worker mid-run and watch the platform retry the job on a new attempt.

---

## Using the API

Create a key under **API keys**, or use the one the seed printed.

```sh
KEY=ce_live_...
curl -s -X POST http://localhost:3000/v1/executions \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"language":"python","files":[{"path":"main.py","content":"print(6*7)"}],"entryFile":"main.py"}'
# -> {"id":"...","status":"QUEUED"}

curl -s http://localhost:3000/v1/executions/<id> -H "authorization: Bearer $KEY"
curl -s "http://localhost:3000/v1/executions/<id>/logs?stream=stdout&inline=true" -H "authorization: Bearer $KEY"
```

- Request body: `language` (`python`, `node`, `c`, `cpp`), `files` (up to 20), `entryFile`, optional `stdin` and
  `limits` (`timeoutMs`, `memoryMb`).
- Send an `Idempotency-Key` header to make retries safe.
- Over-limit requests are rejected, not clamped. Rate limiting returns `429` with `Retry-After`.
- Statuses: `QUEUED → DISPATCHED → STARTING → RUNNING → SUCCESS | FAILED | TIMEOUT | CANCELLED | DEAD_LETTERED`.
- Full reference: <http://localhost:3000/docs> (OpenAPI JSON).

---

## Repository layout

```
apps/
  api/        Fastify control plane: auth, API keys, executions, SSE, admin, metrics, reaper
  worker/     Worker agent: claim, lease and heartbeat, sandbox run, fenced completion, self-test
  web/        React + Vite + Tailwind + shadcn/ui dashboard (Monaco editor)
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
docs/         architecture, security, failures, runbook, assumptions, plan, milestones, walkthrough, test report
```

---

## Tests

```sh
pnpm install

# fast unit tests (state machine, validation, limits, hashing, result mapping)
npx vitest run --project unit

# API integration tests (real Postgres, Redis and MinIO from compose; compose Redis is on host port 6380).
# They use a stub worker, so stop the real one first; the suite refuses to run otherwise.
docker compose stop worker
REDIS_URL=redis://localhost:6380 npx vitest run --project integration
docker compose start worker

# sandbox abuse suite: timeouts, memory bombs, fork bombs, network, host files, forbidden syscalls, output floods
docker compose exec worker sh -c 'cd /app/packages/sandbox && npx vitest run test/abuse'

# failure and recovery suite: worker kill, lost heartbeats, dead letters, Postgres/S3/Redis down, API crash (~10 min)
bash scripts/chaos/run-all.sh

# browser tests (Playwright) against http://localhost:5173
cd apps/web && npx playwright install chromium && npx playwright test

# load test
API_KEY=ce_live_... pnpm loadtest -- --clients 10 --jobs 60
```

Results and what has and hasn't been verified: [docs/TEST_REPORT.md](docs/TEST_REPORT.md).

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Runs stay **Queued** forever | The worker isn't running or failed its self-test. `docker compose ps`, then `docker compose logs worker`. Start it with `docker compose up -d worker`. |
| Worker logs `self-test FAILED` | The message names the failing check. Usually cgroup v2 isn't available or the container isn't privileged. The compose file sets `privileged: true` and a private cgroup namespace for the worker; keep both. |
| `port is already allocated` | Another program uses the port. Redis is mapped to host port **6380** on purpose because a local Redis often owns 6379. Change the host side of the mapping in `infra/docker-compose.yml`. |
| Pulling the MinIO image fails | Docker Hub no longer serves `minio/minio`. Compose uses `cgr.dev/chainguard/minio`; make sure Docker can reach `cgr.dev`. |
| `readyz` shows an error for postgres, redis or s3 | That dependency isn't up yet or is down. Wait a few seconds, check `docker compose ps`. |
| Integration tests say "a real worker is attached" | Run `docker compose stop worker` first (see [Tests](#tests)). |
| Dashboard shows "Sign in" again and again | Your session expired, or `WEB_ORIGIN` / `COOKIE_SECURE` don't match how you are reaching the app. |
| Blank or stale page after a rebuild | Hard-refresh the browser, or `docker compose up -d --build web`. |
| Want a clean slate | `docker compose down -v`, then start and seed again. This deletes all data. |
| Windows: odd line-ending errors in shell scripts | The repo enforces LF via `.gitattributes`. Re-clone, or run `git add --renormalize .`. |

---

## Docs

- [Walkthrough](docs/WALKTHROUGH.md): a guided tour of the app
- [Architecture](docs/ARCHITECTURE.md), including the system diagram and known limitations
- [Security](docs/SECURITY.md)
- [Failure matrix](docs/FAILURES.md)
- [Runbook](docs/RUNBOOK.md)
- [Assumptions and deviations](docs/ASSUMPTIONS.md)
- [Plan](docs/PLAN.md) and [Milestones](docs/MILESTONES.md)
- [Test report](docs/TEST_REPORT.md)
