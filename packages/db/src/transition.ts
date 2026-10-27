import { ACTIVE_STATES, canTransition, type ExecutionStatus, type StatusEvent } from '@engine/shared';
import { withTx, type Pool, type PoolClient } from './pool.ts';

/** Columns a transition may set besides status/timestamps. */
const SETTABLE = [
  'exit_code',
  'term_signal',
  'failure_reason',
  'wall_ms',
  'cpu_ms',
  'peak_memory_bytes',
  'stdout_truncated',
  'stderr_truncated',
  'max_attempts',
] as const;
type Settable = (typeof SETTABLE)[number];

export interface TransitionArgs {
  id: string;
  /** When given, the update is also scoped to this tenant. */
  tenantId?: string;
  from: ExecutionStatus | readonly ExecutionStatus[];
  to: ExecutionStatus;
  /** Fence on the attempt number. */
  attempt?: number;
  /** Only transition if the lease has actually expired (reaper). */
  requireLeaseExpired?: boolean;
  set?: Partial<Record<Settable, unknown>>;
  /** For transitions to QUEUED: delay the next claim by N seconds. */
  availableAfterSeconds?: number;
  /** Close the current attempt row with this outcome. */
  attemptOutcome?: string;
  detail?: Record<string, unknown>;
}

export interface TransitionResult {
  ok: boolean;
  event?: StatusEvent & { tenantId: string; from: ExecutionStatus };
}

/**
 * The single place where execution status changes (API side; workers use the fenced SQL
 * functions in migrations). Compare-and-set on the current status, event row in the same
 * transaction, tenant concurrency slot released when leaving an active state.
 */
export async function transitionInTx(client: PoolClient, args: TransitionArgs): Promise<TransitionResult> {
  const froms = (Array.isArray(args.from) ? args.from : [args.from]) as ExecutionStatus[];
  for (const from of froms) {
    if (!canTransition(from, args.to)) throw new Error(`illegal transition ${from} -> ${args.to}`);
  }

  const params: unknown[] = [args.id, froms, args.to];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  const sets = ['status = $3'];
  for (const [col, value] of Object.entries(args.set ?? {})) {
    if (!SETTABLE.includes(col as Settable)) throw new Error(`column not settable: ${col}`);
    sets.push(`${col} = ${p(value)}`);
  }
  if (args.to === 'QUEUED') {
    sets.push(`available_at = now() + make_interval(secs => ${p(args.availableAfterSeconds ?? 0)})`);
    sets.push('queued_at = coalesce(e.queued_at, now())', 'lease_owner = NULL', 'lease_expires_at = NULL');
  }
  if (['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'DEAD_LETTERED'].includes(args.to)) {
    sets.push('finished_at = now()', 'lease_owner = NULL', 'lease_expires_at = NULL');
  }

  const where = ['e.id = $1', 'e.status = ANY($2::text[])'];
  if (args.tenantId) where.push(`e.tenant_id = ${p(args.tenantId)}`);
  if (args.attempt !== undefined) where.push(`e.attempt = ${p(args.attempt)}`);
  if (args.requireLeaseExpired) where.push('e.lease_expires_at < now()');

  const res = await client.query<{ from_status: ExecutionStatus; tenant_id: string; attempt: number }>(
    `WITH prev AS (SELECT id, status FROM executions WHERE id = $1 FOR UPDATE)
     UPDATE executions e SET ${sets.join(', ')}
     FROM prev
     WHERE prev.id = e.id AND ${where.join(' AND ')}
     RETURNING prev.status AS from_status, e.tenant_id, e.attempt`,
    params,
  );
  const row = res.rows[0];
  if (!row) return { ok: false };

  if (ACTIVE_STATES.includes(row.from_status) && !ACTIVE_STATES.includes(args.to)) {
    await client.query(
      'UPDATE tenant_concurrency SET running = greatest(running - 1, 0) WHERE tenant_id = $1',
      [row.tenant_id],
    );
  }
  if (args.attemptOutcome && row.attempt > 0) {
    await client.query(
      `UPDATE execution_attempts SET finished_at = now(), outcome = $3
       WHERE execution_id = $1 AND attempt = $2 AND finished_at IS NULL`,
      [args.id, row.attempt, args.attemptOutcome],
    );
  }
  const ev = await client.query<{ at: Date }>(
    `INSERT INTO execution_events (execution_id, attempt, from_status, to_status, detail)
     VALUES ($1, $2, $3, $4, $5) RETURNING at`,
    [args.id, row.attempt, row.from_status, args.to, args.detail ?? null],
  );
  return {
    ok: true,
    event: {
      id: args.id,
      tenantId: row.tenant_id,
      from: row.from_status,
      status: args.to,
      attempt: row.attempt,
      at: ev.rows[0]!.at.toISOString(),
    },
  };
}

export type CommitHook = (event: NonNullable<TransitionResult['event']>) => void | Promise<void>;

/** Run one transition in its own transaction; `afterCommit` (Redis publish, cache invalidation) runs after COMMIT. */
export async function transitionExecution(
  pool: Pool,
  args: TransitionArgs,
  afterCommit?: CommitHook,
): Promise<TransitionResult> {
  const result = await withTx(pool, (client) => transitionInTx(client, args));
  if (result.ok && result.event && afterCommit) await afterCommit(result.event);
  return result;
}
