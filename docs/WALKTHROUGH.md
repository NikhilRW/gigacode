# Walkthrough

A guided tour of the app, about 20 minutes. It assumes the stack is running and seeded
(see [Setup](../README.md#setup-guide)). Everything below is something you can do right now.

> **State of the UI.** Sign-in, Register, Overview, the Playground, API keys and Settings use the new design.
> The Runs list, run detail and Admin pages work but still use the earlier layout; they are being redesigned
> (see [PLAN.md](PLAN.md)). The steps say which is which.

Accounts from the seed:

| Role | Email | Password |
|---|---|---|
| Demo tenant owner | `demo@example.com` | `demo-password-123` |
| Platform admin | `admin@example.com` | `admin-password-123` |

---

## 1. Create your own workspace

Open <http://localhost:5173/register> (or use the demo account and skip to step 2).

1. Fill in your name, a workspace name, an email and a password of at least 10 characters.
2. Press **Create account**. You land on **Overview**.

Each workspace is a tenant: its runs, API keys and limits are private to it. Another workspace can never read your
runs; asking for one returns "not found".

## 2. Overview

- **Greeting:** uses your name (or the part of your email before the @ if you didn't give one).
- **How a run works:** your code is queued, a worker runs it in an isolated sandbox, and the result is stored.
- **Activity:** runs in progress, queued, success rate over 24 hours and runs today, plus a runs-per-hour chart.
- **Get set up:** three steps that tick themselves off when you actually do them:
  1. Run your first program
  2. Create an API key
  3. Call the API from your terminal
- **Recent runs** and **Plan limits** (concurrency, runs per minute, time, memory, source size).

Come back here after each step below and watch the checklist update.

## 3. Run your first program (Playground)

Sidebar → **Playground**.

1. Keep the Python starter and press **Run** (or **Ctrl+Enter** / **⌘↵**).
2. Watch the strip above the output: **Queued → Starting → Running → Done**.
3. You get the output, plus exit code, wall time, CPU time and peak memory.

Things to try:

| Try this | What happens |
|---|---|
| Switch the language (Python, Node.js, C, C++) | The starter program changes. If you've edited the code, you're asked before it is replaced. |
| **Input** tab, type `Ada`, run `print("Hi", input())` | The text is sent to the program as standard input. |
| **+ File**, name it `util.py`, then `import util` in `main.py` | Multi-file programs work (up to 20 files, folders allowed). Use the **⋯** menu on a tab to rename or delete. |
| **Limits** button | Set the time limit (seconds) and memory (MB). The maximums come from your workspace. |
| Reload the page | Your code and limits are still there (saved in your browser). |

### See what failures look like

Each of these ends with a plain-language explanation and a suggested next step. Paste the code, run it.

**Timeout.** Set the time limit to 1 second first.

```python
print("working...")
while True:
    pass
```

Result: "Timed out after 1.00 s". The `working...` line is kept in the output.

**Out of memory.** Set memory to 64 MB first.

```python
data = []
while True:
    data.append(bytearray(1 << 20))
```

Result: "Ran out of memory (64 MB limit)".

**Compile error.** Switch to C.

```c
int main(void) { return undefined_name; }
```

Result: "Compile error", and the **stderr** tab opens by itself with the compiler's message.

**Blocked network.** Switch to Python.

```python
import socket
try:
    socket.create_connection(("1.1.1.1", 53), timeout=2)
    print("connected")
except OSError as e:
    print("no network:", e)
```

Result: `no network: ...`. Sandboxed programs have no network at all, including the cloud metadata address.

**Read-only system files.**

```python
open("/usr/local/bin/evil", "w").write("x")
```

Result: a "Read-only file system" or "Permission denied" error.

**Fork bomb.**

```python
import os
while True:
    os.fork()
```

Result: contained by the process limit. The run does not affect other runs or the worker.

## 4. Runs (earlier layout)

Sidebar → **Runs**.

- Filter by status, language and date, and page through the results.
- Click a run to open its detail page: metadata, state timeline, attempts, output.
- **Re-run** submits the same files again. **Cancel** is available while a run is active.

Run something slow in the Playground (`import time; time.sleep(8)`, with the time limit set to 10 s), open it in **Runs** while it is running, and press **Cancel**.

## 5. API keys and the REST API

Sidebar → **API keys**.

1. Press **Create key**, give it a name (for example `ci-pipeline`) and confirm.
2. The key is shown **once**, with a **Copy key** button. Only a hash is stored, so it cannot be shown again. The
   dialog also has ready-made **curl**, **JavaScript** and **Python** examples with your key already filled in.
3. Press **I've saved the key**. The key appears in the list as **Active**, with its created time and when it was
   last used.
4. Run it from a terminal:

```sh
KEY=ce_live_...        # paste your key

# submit
curl -s -X POST http://localhost:3000/v1/executions \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"language":"python","files":[{"path":"main.py","content":"print(6*7)"}],"entryFile":"main.py"}'
# -> {"id":"<id>","status":"QUEUED"}

# poll, then read the output
curl -s http://localhost:3000/v1/executions/<id> -H "authorization: Bearer $KEY"
curl -s "http://localhost:3000/v1/executions/<id>/logs?stream=stdout&inline=true" -H "authorization: Bearer $KEY"
```

Reload the page: the key's **Last used** column is no longer "Never". Go back to **Overview**: steps 2 and 3 of the
checklist are ticked.

To stop a key working, press **Revoke** on its row and confirm. It fails with "invalid API key" straight away.

Useful details:

- Add an `Idempotency-Key` header to a submit. Sending the same request again returns the same run instead of
  creating a second one; reusing the key with a different body returns `409`.
- Going over your per-minute rate returns `429` with a `Retry-After` header.
- Asking for a time or memory above your workspace maximum is rejected with a clear error, not silently lowered.
- The full API is described at <http://localhost:3000/docs> (OpenAPI JSON).

## 6. Settings

Sidebar → **Account → Settings**.

- **Profile:** set your name. The Overview greeting uses it right away.
- **Password:** enter your current password and a new one (at least 10 characters) twice. A wrong current password
  is explained next to the field, and a mismatch is caught before anything is sent. You stay signed in afterwards.
- **Appearance:** switch between Light and Dark. The choice is remembered on this device.
- **Workspace limits:** what your workspace is allowed (runs at the same time, runs per minute, longest run, memory,
  source size). Only a platform admin can change these.
- **Session:** sign out of this browser.

## 7. Admin (earlier layout)

Sign out (bottom-left menu), sign in as `admin@example.com`, then sidebar → **Admin → Platform**.

- **Workers:** which workers are alive and how many slots are busy.
- **Queue:** how many runs are waiting, the age of the oldest, and a breakdown by tenant.
- **Dead-lettered executions:** runs that failed because workers kept dying. **Requeue** gives one more chance.
- **Tenants and limits:** edit a workspace's concurrency, per-minute rate, time, memory and source size.

Try it: lower the demo tenant's **max concurrent** to 1, then submit several slow runs from the demo account. Only one
runs at a time, and other tenants are not blocked.

## 8. Watch the platform from the outside

| What | Where |
|---|---|
| Metrics (queue depth, oldest queued age, slots, lease expirations, fenced results, rate limits) | <http://localhost:3000/metrics> |
| Health | <http://localhost:3000/readyz> |
| Stored source, logs and results | MinIO console <http://localhost:9001>, login `minio` / `minio12345`, bucket `engine-artifacts` |
| Worker logs | `docker compose logs -f worker` |
| Run history in the database | `docker compose exec postgres psql -U app -d engine -c "select to_char(at,'HH24:MI:SS'), from_status, to_status from execution_events order by id desc limit 15"` |

Source and logs live in S3; Postgres holds only metadata.

## 9. Break things on purpose

The platform is built to recover from these. Submit a run that sleeps for 8 seconds (`import time; time.sleep(8)`, with the Limits time set to 10 s), and
while it is running, in a terminal:

```sh
# Kill the worker abruptly mid-run
docker compose kill -s KILL worker
docker compose up -d worker
```

Watch the run in **Runs**: after the lease expires (about 30 s) it is queued again, and a new attempt finishes it.
The run's **Attempts** section shows two attempts.

Other experiments:

```sh
docker compose stop postgres    # new runs get 503; cached reads still work
docker compose start postgres   # recovers without restarting the API

docker compose stop redis       # everything keeps working (caching and live updates degrade)
docker compose start redis

docker compose stop worker      # runs queue up and show as Queued
docker compose start worker     # they drain
```

To run all the failure scenarios automatically (about 10 minutes):

```sh
bash scripts/chaos/run-all.sh
```

## 10. Where to go next

- How the pieces fit: [ARCHITECTURE.md](ARCHITECTURE.md)
- What the sandbox does and does not protect against: [SECURITY.md](SECURITY.md)
- Every failure, how it is detected and recovered: [FAILURES.md](FAILURES.md)
- Operating it: [RUNBOOK.md](RUNBOOK.md)
- Test evidence: [TEST_REPORT.md](TEST_REPORT.md)
