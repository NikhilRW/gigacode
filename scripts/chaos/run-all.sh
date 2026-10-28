#!/usr/bin/env bash
# Failure and recovery suite (Build-spec §15). Runs against the docker compose stack.
# Usage: bash scripts/chaos/run-all.sh [scenario...]   (default: all)
# Requires: stack up (docker compose up -d), seed run (admin@example.com), curl, sed.
set -uo pipefail
cd "$(dirname "$0")/../.."

# Same project name as the root docker-compose.yml, so this drives the running stack.
DC="docker compose -p code-exec-engine -f infra/docker-compose.yml -f infra/docker-compose.chaos.yml"
B="${API_URL:-http://localhost:3000}"
RESULTS=()
pass() { RESULTS+=("PASS  $1"); echo "  PASS: $1"; }
fail() { RESULTS+=("FAIL  $1 -- $2"); echo "  FAIL: $1 -- $2"; }
psql() { $DC exec -T postgres psql -U app -d engine -tAc "$1"; }

# ---- helpers -------------------------------------------------------------------------------
JAR=$(mktemp)
ADMIN_JAR=$(mktemp)
login() {  # register a fresh tenant, create an API key -> $KEY
  local email="chaos$RANDOM$RANDOM@example.com"
  local me csrf
  me=$(curl -s -c "$JAR" -X POST "$B/v1/auth/register" -H 'content-type: application/json' \
    -d "{\"tenantName\":\"Chaos\",\"email\":\"$email\",\"password\":\"password-1234\"}")
  csrf=$(echo "$me" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
  KEY=$(curl -s -b "$JAR" -X POST "$B/v1/api-keys" -H "x-csrf-token: $csrf" -H 'content-type: application/json' \
    -d '{"name":"chaos"}' | sed -E 's/.*"key":"([^"]+)".*/\1/')
}
admin_login() {
  local me
  me=$(curl -s -c "$ADMIN_JAR" -X POST "$B/v1/auth/login" -H 'content-type: application/json' \
    -d '{"email":"admin@example.com","password":"admin-password-123"}')
  ADMIN_CSRF=$(echo "$me" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
}
submit() {  # submit <python code> [timeoutMs] -> prints id
  local code="$1" t="${2:-10000}"
  curl -s -X POST "$B/v1/executions" -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
    -d "{\"language\":\"python\",\"files\":[{\"path\":\"main.py\",\"content\":\"$code\"}],\"entryFile\":\"main.py\",\"limits\":{\"timeoutMs\":$t}}" \
    | sed -E 's/.*"id":"([^"]+)".*/\1/'
}
status() { psql "select status from executions where id='$1'"; }
attempt() { psql "select attempt from executions where id='$1'"; }
wait_status() {  # wait_status <id> <regex> <seconds>
  local i
  for ((i = 0; i < $3; i++)); do
    [[ "$(status "$1")" =~ ^($2)$ ]] && return 0
    sleep 1
  done
  return 1
}
metric() { curl -s "$B/metrics" | grep -E "^$1(\{| )" | awk '{s+=$NF} END {print s+0}'; }
workers_normal() { $DC stop worker-chaos >/dev/null 2>&1; $DC up -d worker >/dev/null 2>&1; }
workers_chaos_only() { $DC stop worker >/dev/null 2>&1; $DC --profile chaos up -d worker-chaos >/dev/null 2>&1; }

SLEEP8='import time\ntime.sleep(8)\nprint(\"done\")'

# ---- scenarios -----------------------------------------------------------------------------
kill_worker() {
  echo "[kill_worker] kill -9 the worker mid-run -> lease expiry -> requeue -> new attempt completes"
  workers_normal
  local id; id=$(submit "$SLEEP8")
  wait_status "$id" RUNNING 30 || { fail kill_worker "never reached RUNNING"; return; }
  $DC kill -s KILL worker >/dev/null
  $DC up -d worker >/dev/null
  if wait_status "$id" SUCCESS 120 && [ "$(attempt "$id")" -ge 2 ]; then
    pass "kill_worker (final attempt $(attempt "$id"))"
  else
    fail kill_worker "status=$(status "$id") attempt=$(attempt "$id")"
  fi
}

partition() {
  echo "[partition] worker cannot heartbeat -> lease lost -> runs elsewhere -> stale result fenced"
  local before; before=$(metric fenced_results_discarded_total)
  workers_chaos_only
  local id; id=$(submit "$SLEEP8")
  wait_status "$id" RUNNING 30 || { fail partition "never reached RUNNING"; workers_normal; return; }
  sleep 12  # chaos worker finishes at ~8s with an expired lease -> fenced
  workers_normal
  wait_status "$id" SUCCESS 120
  local after; after=$(metric fenced_results_discarded_total)
  local tenant; tenant=$(psql "select tenant_id from executions where id='$id'")
  local stale; stale=$(psql "select count(*) from execution_attempts where execution_id='$id' and attempt=1 and result_prefix is not null")
  if [ "$(status "$id")" = SUCCESS ] && [ "$(attempt "$id")" -ge 2 ] && [ "$after" -gt "$before" ] && [ "$stale" = 0 ]; then
    pass "partition (fenced counter $before -> $after, final attempt $(attempt "$id"))"
  else
    fail partition "status=$(status "$id") attempt=$(attempt "$id") fenced $before->$after stale_rows=$stale tenant=$tenant"
  fi
}

dlq() {
  echo "[dlq] exhaust max_attempts -> DEAD_LETTERED; admin requeue works"
  workers_chaos_only
  local id; id=$(submit "$SLEEP8")
  if ! wait_status "$id" DEAD_LETTERED 240; then
    fail dlq "status=$(status "$id") attempt=$(attempt "$id")"; workers_normal; return
  fi
  workers_normal
  admin_login
  curl -s -b "$ADMIN_JAR" -X POST "$B/v1/admin/dlq/$id/requeue" -H "x-csrf-token: $ADMIN_CSRF" >/dev/null
  if wait_status "$id" SUCCESS 90; then pass "dlq (dead-lettered after 3 attempts, requeued, succeeded)"
  else fail dlq "after requeue status=$(status "$id")"; fi
}

postgres_down() {
  echo "[postgres_down] writes 503, cached reads served, recovery without restart"
  workers_normal
  local id; id=$(submit 'print(1)')
  wait_status "$id" SUCCESS 60
  curl -s "$B/v1/executions/$id" -H "authorization: Bearer $KEY" >/dev/null  # warm cache
  $DC stop postgres >/dev/null
  local w r
  w=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/v1/executions" -H "authorization: Bearer $KEY" \
    -H 'content-type: application/json' -d '{"language":"python","files":[{"path":"main.py","content":"print(2)"}],"entryFile":"main.py"}')
  r=$(curl -s -o /dev/null -w '%{http_code}' "$B/v1/executions/$id" -H "authorization: Bearer $KEY")
  $DC start postgres >/dev/null
  local i; for ((i = 0; i < 60; i++)); do curl -sf "$B/readyz" >/dev/null && break; sleep 1; done
  local id2; id2=$(submit 'print(3)')
  if [ "$w" = 503 ] && [ "$r" = 200 ] && wait_status "$id2" SUCCESS 90; then
    pass "postgres_down (write=$w cached read=$r, recovered)"
  else
    fail postgres_down "write=$w read=$r after=$(status "$id2")"
  fi
}

s3_down() {
  echo "[s3_down] S3 down during result upload -> retries -> job recovers, single authoritative result"
  workers_normal
  local id; id=$(submit 'import time\ntime.sleep(4)\nprint(\"after s3\")')
  wait_status "$id" RUNNING 30 || { fail s3_down "never RUNNING"; return; }
  $DC stop minio >/dev/null
  sleep 15
  $DC start minio >/dev/null
  if wait_status "$id" SUCCESS 150; then
    local n; n=$(psql "select count(*) from execution_attempts where execution_id='$id' and result_prefix is not null")
    local out; out=$(curl -s "$B/v1/executions/$id/logs?stream=stdout&inline=true" -H "authorization: Bearer $KEY")
    if [ "$n" = 1 ] && [ "$out" = "after s3" ]; then pass "s3_down (attempts=$(attempt "$id"), 1 authoritative result)"
    else fail s3_down "results=$n stdout=$out"; fi
  else
    fail s3_down "status=$(status "$id")"
  fi
}

redis_down() {
  echo "[redis_down] no request fails because of Redis alone"
  workers_normal
  $DC stop redis >/dev/null
  local id; id=$(submit 'print(\"no redis\")')
  local ok=1
  [ -n "$id" ] && [ "${#id}" = 36 ] || ok=0
  wait_status "$id" SUCCESS 60 || ok=0
  local r; r=$(curl -s -o /dev/null -w '%{http_code}' "$B/v1/executions/$id" -H "authorization: Bearer $KEY")
  $DC start redis >/dev/null
  if [ $ok = 1 ] && [ "$r" = 200 ]; then pass "redis_down (submit, run and read all worked)"
  else fail redis_down "id=$id status=$(status "$id") read=$r"; fi
}

api_crash() {
  echo "[api_crash] stuck CREATED rows fixed by the reconciler"
  workers_normal
  # Row whose source upload completed but the API died before CREATED -> QUEUED.
  local id; id=$(submit 'print(\"recovered\")')
  wait_status "$id" SUCCESS 60
  local tenant; tenant=$(psql "select tenant_id from executions where id='$id'")
  local id2; id2=$(psql "select gen_random_uuid()")
  psql "insert into executions (id, tenant_id, request_hash, language, entry_file, status, limits, artifact_prefix, created_at)
        select '$id2', tenant_id, 'x', language, entry_file, 'CREATED', limits, artifact_prefix, now() - interval '2 minutes'
        from executions where id='$id'" >/dev/null
  # Source objects for id2 are absent -> must become FAILED artifact_missing.
  # Simulate "uploaded, then crashed": reuse an execution row that has source, put it back to CREATED.
  psql "update executions set status='CREATED', created_at = now() - interval '2 minutes', finished_at=null where id='$id'" >/dev/null
  if wait_status "$id2" FAILED 40 && [ "$(psql "select failure_reason from executions where id='$id2'")" = artifact_missing ] \
     && wait_status "$id" 'QUEUED|DISPATCHED|STARTING|RUNNING|SUCCESS' 40; then
    pass "api_crash (missing source -> FAILED artifact_missing; uploaded source -> requeued)"
  else
    fail api_crash "missing=$(status "$id2") uploaded=$(status "$id") tenant=$tenant"
  fi
}

# ---- main ----------------------------------------------------------------------------------
curl -sf "$B/readyz" >/dev/null || { echo "stack not ready at $B"; exit 1; }
login
SCENARIOS=("$@")
[ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(kill_worker partition dlq postgres_down s3_down redis_down api_crash)
for s in "${SCENARIOS[@]}"; do "$s"; done
workers_normal
echo
echo "==== chaos summary ===="
printf '%s\n' "${RESULTS[@]}"
printf '%s\n' "${RESULTS[@]}" | grep -q '^FAIL' && exit 1 || exit 0
