-- Up Migration
-- An attempt whose lease has expired has lost authority even if the reaper has not yet
-- requeued it. Completion now also requires an unexpired lease.

CREATE OR REPLACE FUNCTION worker_complete(
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
      AND e.lease_expires_at >= now()
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

-- Down Migration
SELECT 1;
