import type { AdminTenant, Execution, QueueStats, TenantLimitsPatch } from '@engine/shared';
import type { Queryable } from '../pool.ts';
import { toAdminTenant, toExecution, type ExecutionRow, type TenantRow } from '../rows.ts';
import { isUuid } from './executions.ts';

export interface WorkerRow {
  id: string;
  hostname: string;
  version: string;
  slots: number;
  status: string;
  started_at: Date;
  last_heartbeat_at: Date;
}

/**
 * Cross-tenant queries for platform_admin routes, metrics and the reaper.
 * Never use from tenant-facing routes.
 */
export class PlatformRepo {
  constructor(private readonly db: Queryable) {}

  async queueStats(): Promise<QueueStats> {
    const totals = await this.db.query<{ depth: number; oldest: number }>(
      `SELECT count(*)::int AS depth,
              coalesce(extract(epoch FROM now() - min(queued_at)), 0)::float8 AS oldest
       FROM executions WHERE status = 'QUEUED'`,
    );
    const byTenant = await this.db.query<{ tenant_id: string; name: string; queued: number; running: number }>(
      `SELECT t.id AS tenant_id, t.name,
              count(*) FILTER (WHERE e.status = 'QUEUED')::int AS queued,
              count(*) FILTER (WHERE e.status IN ('DISPATCHED', 'STARTING', 'RUNNING'))::int AS running
       FROM executions e JOIN tenants t ON t.id = e.tenant_id
       WHERE e.status IN ('QUEUED', 'DISPATCHED', 'STARTING', 'RUNNING')
       GROUP BY t.id, t.name ORDER BY queued DESC`,
    );
    return {
      depth: totals.rows[0]!.depth,
      oldestAgeSeconds: totals.rows[0]!.oldest,
      byTenant: byTenant.rows.map((r) => ({
        tenantId: r.tenant_id,
        tenantName: r.name,
        queued: r.queued,
        running: r.running,
      })),
    };
  }

  async workers(): Promise<WorkerRow[]> {
    const res = await this.db.query<WorkerRow>('SELECT * FROM workers ORDER BY last_heartbeat_at DESC LIMIT 200');
    return res.rows;
  }

  async deadLettered(limit = 100): Promise<Execution[]> {
    const res = await this.db.query<ExecutionRow>(
      `SELECT * FROM executions WHERE status = 'DEAD_LETTERED' ORDER BY finished_at DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map(toExecution);
  }

  async findExecution(id: string): Promise<ExecutionRow | null> {
    if (!isUuid(id)) return null;
    const res = await this.db.query<ExecutionRow>('SELECT * FROM executions WHERE id = $1', [id]);
    return res.rows[0] ?? null;
  }

  async tenants(): Promise<AdminTenant[]> {
    const res = await this.db.query<TenantRow>('SELECT * FROM tenants ORDER BY created_at');
    return res.rows.map(toAdminTenant);
  }

  async updateTenantLimits(id: string, patch: TenantLimitsPatch): Promise<AdminTenant | null> {
    if (!isUuid(id)) return null;
    const columns: Record<keyof TenantLimitsPatch, string> = {
      maxConcurrent: 'max_concurrent',
      maxExecPerMin: 'max_exec_per_min',
      maxTimeoutMs: 'max_timeout_ms',
      maxMemoryMb: 'max_memory_mb',
      maxSourceBytes: 'max_source_bytes',
    };
    const params: unknown[] = [id];
    const sets = Object.entries(patch).map(([k, v]) => {
      params.push(v);
      return `${columns[k as keyof TenantLimitsPatch]} = $${params.length}`;
    });
    if (sets.length === 0) {
      const res = await this.db.query<TenantRow>('SELECT * FROM tenants WHERE id = $1', [id]);
      return res.rows[0] ? toAdminTenant(res.rows[0]) : null;
    }
    const res = await this.db.query<TenantRow>(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    return res.rows[0] ? toAdminTenant(res.rows[0]) : null;
  }

  // ---- reaper / reconciler queries ----

  async expiredLeases(limit = 100): Promise<{ id: string; attempt: number; max_attempts: number; status: string }[]> {
    const res = await this.db.query(
      `SELECT id, attempt, max_attempts, status FROM executions
       WHERE status IN ('DISPATCHED', 'STARTING', 'RUNNING') AND lease_expires_at < now()
       ORDER BY lease_expires_at LIMIT $1`,
      [limit],
    );
    return res.rows;
  }

  async stuckCreated(olderThanSeconds = 60, limit = 100): Promise<{ id: string; tenant_id: string }[]> {
    const res = await this.db.query(
      `SELECT id, tenant_id FROM executions
       WHERE status = 'CREATED' AND created_at < now() - make_interval(secs => $1) LIMIT $2`,
      [olderThanSeconds, limit],
    );
    return res.rows;
  }

  /** Recompute tenant_concurrency.running from actual rows. Returns tenants whose counter drifted. */
  async healConcurrency(): Promise<{ tenant_id: string; before: number; after: number }[]> {
    const res = await this.db.query(
      `WITH actual AS (
         SELECT t.id AS tenant_id, count(e.id)::int AS running
         FROM tenants t LEFT JOIN executions e
           ON e.tenant_id = t.id AND e.status IN ('DISPATCHED', 'STARTING', 'RUNNING')
         GROUP BY t.id
       ), upserted AS (
         INSERT INTO tenant_concurrency AS tc (tenant_id, running)
         SELECT a.tenant_id, a.running FROM actual a
         LEFT JOIN tenant_concurrency cur ON cur.tenant_id = a.tenant_id
         WHERE cur.tenant_id IS NULL OR cur.running <> a.running
         ON CONFLICT (tenant_id) DO UPDATE SET running = EXCLUDED.running
         RETURNING tc.tenant_id, tc.running
       )
       SELECT u.tenant_id, coalesce(c.running, 0) AS before, u.running AS after
       FROM upserted u LEFT JOIN tenant_concurrency c ON c.tenant_id = u.tenant_id`,
    );
    return res.rows;
  }

  async markDeadWorkers(silentSeconds = 30): Promise<number> {
    const res = await this.db.query(
      `UPDATE workers SET status = 'dead'
       WHERE status <> 'dead' AND last_heartbeat_at < now() - make_interval(secs => $1)`,
      [silentSeconds],
    );
    return res.rowCount ?? 0;
  }

  async expiredForRetention(days: number, limit = 200): Promise<{ id: string; tenant_id: string }[]> {
    const res = await this.db.query(
      `SELECT id, tenant_id FROM executions
       WHERE status IN ('SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'DEAD_LETTERED')
         AND finished_at < now() - make_interval(days => $1)
       LIMIT $2`,
      [days, limit],
    );
    return res.rows;
  }

  async deleteExecution(id: string): Promise<void> {
    await this.db.query('DELETE FROM executions WHERE id = $1', [id]);
  }
}
