-- Up Migration
-- Workers connect as a member of worker_role. That role has no table privileges at all:
-- it can only call the SECURITY DEFINER functions below, each of which is fenced by
-- (execution id, attempt, lease owner) and touches only the claimed row.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker_role') THEN
    CREATE ROLE worker_role NOLOGIN;
  END IF;
END
$$;

CREATE FUNCTION worker_register(p_id text, p_hostname text, p_version text, p_slots int, p_status text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO workers (id, hostname, version, slots, status, started_at, last_heartbeat_at)
  VALUES (p_id, p_hostname, p_version, p_slots, p_status, now(), now())
  ON CONFLICT (id) DO UPDATE
    SET hostname = EXCLUDED.hostname, version = EXCLUDED.version, slots = EXCLUDED.slots,
        status = EXCLUDED.status, last_heartbeat_at = now();
$$;

-- Claim one runnable job. Skips tenants at max_concurrent, orders by priority, then the
-- tenant that was dispatched least recently (fairness), then age.
CREATE FUNCTION worker_claim(p_worker text, p_lease_seconds int)
RETURNS TABLE (
  id uuid, tenant_id uuid, language text, entry_file text, limits jsonb,
  artifact_prefix text, attempt int, cancel_requested boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cand record;
BEGIN
  FOR cand IN
    SELECT e.id AS eid, e.tenant_id AS tid
    FROM executions e
    JOIN tenants t ON t.id = e.tenant_id
    LEFT JOIN tenant_concurrency tc ON tc.tenant_id = e.tenant_id
    WHERE e.status = 'QUEUED' AND e.available_at <= now()
      AND coalesce(tc.running, 0) < t.max_concurrent
    ORDER BY e.priority DESC, coalesce(tc.last_dispatched_at, 'epoch') ASC, e.created_at ASC
    LIMIT 20
    FOR UPDATE OF e SKIP LOCKED
  LOOP
    INSERT INTO tenant_concurrency (tenant_id) VALUES (cand.tid) ON CONFLICT DO NOTHING;
    UPDATE tenant_concurrency tc2
      SET running = tc2.running + 1, last_dispatched_at = now()
      WHERE tc2.tenant_id = cand.tid
        AND tc2.running < (SELECT t2.max_concurrent FROM tenants t2 WHERE t2.id = cand.tid);
    IF FOUND THEN
      UPDATE executions e2
        SET status = 'DISPATCHED', attempt = e2.attempt + 1, lease_owner = p_worker,
            lease_expires_at = now() + make_interval(secs => p_lease_seconds)
        WHERE e2.id = cand.eid;
      INSERT INTO execution_attempts (id, execution_id, attempt, worker_id)
        SELECT gen_random_uuid(), e3.id, e3.attempt, p_worker FROM executions e3 WHERE e3.id = cand.eid;
      INSERT INTO execution_events (execution_id, attempt, from_status, to_status, detail)
        SELECT e4.id, e4.attempt, 'QUEUED', 'DISPATCHED', jsonb_build_object('workerId', p_worker)
        FROM executions e4 WHERE e4.id = cand.eid;
      RETURN QUERY
        SELECT e5.id, e5.tenant_id, e5.language, e5.entry_file, e5.limits, e5.artifact_prefix,
               e5.attempt, e5.cancel_requested
        FROM executions e5 WHERE e5.id = cand.eid;
      RETURN;
    END IF;
  END LOOP;
END
$$;

-- Extend the lease. Zero rows returned means the lease was lost.
CREATE FUNCTION worker_heartbeat(p_id uuid, p_worker text, p_attempt int, p_lease_seconds int)
RETURNS TABLE (cancel_requested boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE executions e
    SET lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    WHERE e.id = p_id AND e.lease_owner = p_worker AND e.attempt = p_attempt
      AND e.status IN ('DISPATCHED', 'STARTING', 'RUNNING')
    RETURNING e.cancel_requested;
$$;

-- DISPATCHED -> STARTING and STARTING -> RUNNING only.
CREATE FUNCTION worker_advance(p_id uuid, p_worker text, p_attempt int, p_from text, p_to text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT ((p_from = 'DISPATCHED' AND p_to = 'STARTING') OR (p_from = 'STARTING' AND p_to = 'RUNNING')) THEN
    RAISE EXCEPTION 'illegal worker transition % -> %', p_from, p_to;
  END IF;
  UPDATE executions e
    SET status = p_to, started_at = CASE WHEN p_to = 'RUNNING' THEN now() ELSE e.started_at END
    WHERE e.id = p_id AND e.lease_owner = p_worker AND e.attempt = p_attempt AND e.status = p_from;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO execution_events (execution_id, attempt, from_status, to_status, detail)
    VALUES (p_id, p_attempt, p_from, p_to, jsonb_build_object('workerId', p_worker));
  RETURN true;
END
$$;

-- Fenced completion. Returns false when this attempt no longer holds authority.
CREATE FUNCTION worker_complete(
  p_id uuid, p_worker text, p_attempt int, p_status text,
  p_exit_code int, p_term_signal text, p_failure_reason text,
  p_wall_ms int, p_cpu_ms bigint, p_peak_memory bigint,
  p_stdout_truncated boolean, p_stderr_truncated boolean, p_result_prefix text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prev text;
  tid uuid;
BEGIN
  IF p_status NOT IN ('SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED') THEN
    RAISE EXCEPTION 'illegal completion status %', p_status;
  END IF;
  SELECT e.status, e.tenant_id INTO prev, tid FROM executions e
    WHERE e.id = p_id AND e.attempt = p_attempt AND e.lease_owner = p_worker
      AND (e.status IN ('STARTING', 'RUNNING') OR (e.status = 'DISPATCHED' AND p_status = 'CANCELLED'))
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF prev = 'STARTING' AND p_status NOT IN ('FAILED', 'CANCELLED') THEN
    RAISE EXCEPTION 'illegal transition STARTING -> %', p_status;
  END IF;
  UPDATE executions e
    SET status = p_status, exit_code = p_exit_code, term_signal = p_term_signal,
        failure_reason = p_failure_reason, wall_ms = p_wall_ms, cpu_ms = p_cpu_ms,
        peak_memory_bytes = p_peak_memory, stdout_truncated = p_stdout_truncated,
        stderr_truncated = p_stderr_truncated, finished_at = now(),
        lease_owner = NULL, lease_expires_at = NULL
    WHERE e.id = p_id;
  UPDATE tenant_concurrency tc SET running = greatest(tc.running - 1, 0) WHERE tc.tenant_id = tid;
  UPDATE execution_attempts a
    SET finished_at = now(), outcome = p_status, exit_code = p_exit_code, result_prefix = p_result_prefix
    WHERE a.execution_id = p_id AND a.attempt = p_attempt;
  INSERT INTO execution_events (execution_id, attempt, from_status, to_status, detail)
    VALUES (p_id, p_attempt, prev, p_status,
            jsonb_build_object('workerId', p_worker, 'exitCode', p_exit_code, 'failureReason', p_failure_reason));
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION worker_register(text, text, text, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_claim(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_heartbeat(uuid, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_advance(uuid, text, int, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_complete(uuid, text, int, text, int, text, text, int, bigint, bigint, boolean, boolean, text) FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO worker_role;
GRANT EXECUTE ON FUNCTION worker_register(text, text, text, int, text) TO worker_role;
GRANT EXECUTE ON FUNCTION worker_claim(text, int) TO worker_role;
GRANT EXECUTE ON FUNCTION worker_heartbeat(uuid, text, int, int) TO worker_role;
GRANT EXECUTE ON FUNCTION worker_advance(uuid, text, int, text, text) TO worker_role;
GRANT EXECUTE ON FUNCTION worker_complete(uuid, text, int, text, int, text, text, int, bigint, bigint, boolean, boolean, text) TO worker_role;

-- Down Migration
DROP FUNCTION worker_complete(uuid, text, int, text, int, text, text, int, bigint, bigint, boolean, boolean, text);
DROP FUNCTION worker_advance(uuid, text, int, text, text);
DROP FUNCTION worker_heartbeat(uuid, text, int, int);
DROP FUNCTION worker_claim(text, int);
DROP FUNCTION worker_register(text, text, text, int, text);
