import type {
  Execution,
  ExecutionAttempt,
  ExecutionEvent,
  Limits,
  ListExecutionsQuery,
  Onboarding,
  Timeseries,
  Usage,
} from '@engine/shared';
import type { Queryable } from '../pool.ts';
import { toAttempt, toEvent, toExecution, type ExecutionRow } from '../rows.ts';

export interface NewExecution {
  id: string;
  createdByUserId: string | null;
  apiKeyId: string | null;
  idempotencyKey: string | null;
  requestHash: string;
  language: string;
  entryFile: string;
  priority: number;
  limits: Limits;
  artifactPrefix: string;
}

function encodeCursor(createdAt: string, id: string) {
  return Buffer.from(`${createdAt}|${id}`).toString('base64url');
}
function decodeCursor(cursor: string): [string, string] | null {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
  return [createdAt, id];
}

/**
 * Tenant-scoped access to executions. Every query includes `tenant_id = this.tenantId`;
 * there is no method that takes a tenant id per call.
 */
export class ExecutionRepo {
  constructor(
    private readonly db: Queryable,
    readonly tenantId: string,
  ) {}

  async insertCreated(e: NewExecution): Promise<Execution> {
    const res = await this.db.query<ExecutionRow>(
      `INSERT INTO executions (id, tenant_id, created_by_user_id, api_key_id, idempotency_key, request_hash,
         language, entry_file, status, priority, limits, artifact_prefix)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'CREATED', $9, $10, $11) RETURNING *`,
      [
        e.id,
        this.tenantId,
        e.createdByUserId,
        e.apiKeyId,
        e.idempotencyKey,
        e.requestHash,
        e.language,
        e.entryFile,
        e.priority,
        JSON.stringify(e.limits),
        e.artifactPrefix,
      ],
    );
    await this.db.query(
      `INSERT INTO execution_events (execution_id, attempt, from_status, to_status) VALUES ($1, 0, NULL, 'CREATED')`,
      [e.id],
    );
    return toExecution(res.rows[0]!);
  }

  async findRow(id: string): Promise<ExecutionRow | null> {
    if (!isUuid(id)) return null;
    const res = await this.db.query<ExecutionRow>('SELECT * FROM executions WHERE id = $1 AND tenant_id = $2', [
      id,
      this.tenantId,
    ]);
    return res.rows[0] ?? null;
  }

  async findById(id: string): Promise<Execution | null> {
    const row = await this.findRow(id);
    return row ? toExecution(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<ExecutionRow | null> {
    const res = await this.db.query<ExecutionRow>(
      'SELECT * FROM executions WHERE tenant_id = $1 AND idempotency_key = $2',
      [this.tenantId, key],
    );
    return res.rows[0] ?? null;
  }

  async list(q: ListExecutionsQuery): Promise<{ items: Execution[]; nextCursor: string | null }> {
    const params: unknown[] = [this.tenantId];
    const where = ['tenant_id = $1'];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.status) add('status = ?', q.status);
    if (q.language) add('language = ?', q.language);
    if (q.from) add('created_at >= ?', q.from);
    if (q.to) add('created_at <= ?', q.to);
    if (q.q) add("id::text LIKE ? || '%'", q.q);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      if (c) {
        params.push(c[0], c[1]);
        where.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
      }
    }
    params.push(q.limit + 1);
    const res = await this.db.query<ExecutionRow>(
      `SELECT * FROM executions WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
      params,
    );
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map(toExecution),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.created_at.toISOString(), last.id) : null,
    };
  }

  async events(id: string): Promise<ExecutionEvent[]> {
    const res = await this.db.query(
      `SELECT ev.* FROM execution_events ev JOIN executions e ON e.id = ev.execution_id
       WHERE ev.execution_id = $1 AND e.tenant_id = $2 ORDER BY ev.id`,
      [id, this.tenantId],
    );
    return res.rows.map(toEvent);
  }

  async attempts(id: string): Promise<ExecutionAttempt[]> {
    const res = await this.db.query(
      `SELECT a.* FROM execution_attempts a JOIN executions e ON e.id = a.execution_id
       WHERE a.execution_id = $1 AND e.tenant_id = $2 ORDER BY a.attempt`,
      [id, this.tenantId],
    );
    return res.rows.map(toAttempt);
  }

  /** The attempt whose result is authoritative: the one that completed the execution. */
  async authoritativeResultPrefix(id: string): Promise<string | null> {
    const res = await this.db.query<{ result_prefix: string | null }>(
      `SELECT a.result_prefix FROM execution_attempts a JOIN executions e ON e.id = a.execution_id
       WHERE e.id = $1 AND e.tenant_id = $2 AND a.attempt = e.attempt AND a.result_prefix IS NOT NULL`,
      [id, this.tenantId],
    );
    return res.rows[0]?.result_prefix ?? null;
  }

  async countQueued(): Promise<number> {
    const res = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM executions WHERE tenant_id = $1 AND status IN ('CREATED', 'QUEUED')`,
      [this.tenantId],
    );
    return res.rows[0]!.n;
  }

  /** Mark a running job for cancellation; the worker performs the transition. */
  async requestCancel(id: string): Promise<boolean> {
    const res = await this.db.query(
      `UPDATE executions SET cancel_requested = true
       WHERE id = $1 AND tenant_id = $2 AND status IN ('DISPATCHED', 'STARTING', 'RUNNING')`,
      [id, this.tenantId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** Setup checklist state for the Overview page, derived from existing rows. */
  async onboarding(): Promise<Onboarding> {
    const res = await this.db.query<{ ran: boolean; made: boolean; used: boolean }>(
      `SELECT
         EXISTS (SELECT 1 FROM executions WHERE tenant_id = $1) AS ran,
         EXISTS (SELECT 1 FROM api_keys WHERE tenant_id = $1) AS made,
         EXISTS (SELECT 1 FROM executions WHERE tenant_id = $1 AND api_key_id IS NOT NULL) AS used`,
      [this.tenantId],
    );
    const r = res.rows[0]!;
    return { ranExecution: r.ran, createdApiKey: r.made, usedApiKey: r.used };
  }

  /** Runs submitted per hour for the last `hours` hours (including empty hours), by outcome. */
  async timeseries(hours: number): Promise<Timeseries> {
    const res = await this.db.query<{ at: Date } & Record<'success' | 'failed' | 'timeout' | 'cancelled' | 'other', number>>(
      `SELECT h.at,
         count(e.id) FILTER (WHERE e.status = 'SUCCESS')::int AS success,
         count(e.id) FILTER (WHERE e.status IN ('FAILED', 'DEAD_LETTERED'))::int AS failed,
         count(e.id) FILTER (WHERE e.status = 'TIMEOUT')::int AS timeout,
         count(e.id) FILTER (WHERE e.status = 'CANCELLED')::int AS cancelled,
         count(e.id) FILTER (WHERE e.status NOT IN ('SUCCESS', 'FAILED', 'DEAD_LETTERED', 'TIMEOUT', 'CANCELLED'))::int AS other
       FROM generate_series(
              date_trunc('hour', now()) - make_interval(hours => $2::int - 1),
              date_trunc('hour', now()),
              interval '1 hour') AS h(at)
       LEFT JOIN executions e
         ON e.tenant_id = $1 AND e.created_at >= h.at AND e.created_at < h.at + interval '1 hour'
       GROUP BY h.at ORDER BY h.at`,
      [this.tenantId, hours],
    );
    return { hours, points: res.rows.map((r) => ({ ...r, at: r.at.toISOString() })) };
  }

  async usage(): Promise<Omit<Usage, 'limits'>> {
    const res = await this.db.query<{
      today: number;
      running: number;
      queued: number;
      cpu: number;
      ok24: number;
      done24: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today,
         count(*) FILTER (WHERE status IN ('DISPATCHED', 'STARTING', 'RUNNING'))::int AS running,
         count(*) FILTER (WHERE status IN ('CREATED', 'QUEUED'))::int AS queued,
         coalesce(sum(cpu_ms), 0)::bigint AS cpu,
         count(*) FILTER (WHERE status = 'SUCCESS' AND finished_at >= now() - interval '24 hours')::int AS ok24,
         count(*) FILTER (WHERE status IN ('SUCCESS', 'FAILED', 'TIMEOUT') AND finished_at >= now() - interval '24 hours')::int AS done24
       FROM executions WHERE tenant_id = $1`,
      [this.tenantId],
    );
    const r = res.rows[0]!;
    return {
      executionsToday: r.today,
      running: r.running,
      queued: r.queued,
      totalCpuMs: r.cpu,
      successRate24h: r.done24 > 0 ? r.ok24 / r.done24 : null,
    };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);
