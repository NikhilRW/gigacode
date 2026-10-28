import { ACTIVE_STATES, retryBackoffSeconds, s3Keys } from '@engine/shared';
import { PlatformRepo, transitionExecution } from '@engine/db';
import type { AppContext } from './context.ts';

const LOCK_KEY = 727_001; // arbitrary, stable advisory lock id for the reaper
/** A pass that overruns this is abandoned so a stuck call can never stop requeues for good. */
const PASS_TIMEOUT_MS = 60_000;

export interface ReaperPassStats {
  requeued: number;
  deadLettered: number;
  createdRecovered: number;
  createdFailed: number;
  countersHealed: number;
  workersMarkedDead: number;
  retentionDeleted: number;
}

/** One reaper/reconciler pass (spec §12). Callers must hold the advisory lock (or be a test). */
export async function runReaperPass(ctx: AppContext): Promise<ReaperPassStats> {
  const repo = new PlatformRepo(ctx.pool);
  const log = ctx.logger;
  const stats: ReaperPassStats = {
    requeued: 0,
    deadLettered: 0,
    createdRecovered: 0,
    createdFailed: 0,
    countersHealed: 0,
    workersMarkedDead: 0,
    retentionDeleted: 0,
  };

  // 1. Expired leases.
  for (const job of await repo.expiredLeases()) {
    const exhausted = job.attempt >= job.max_attempts;
    const res = await transitionExecution(
      ctx.pool,
      exhausted
        ? {
            id: job.id,
            from: ACTIVE_STATES,
            to: 'DEAD_LETTERED',
            attempt: job.attempt,
            requireLeaseExpired: true,
            set: { failure_reason: 'max_attempts_exceeded' },
            attemptOutcome: 'lease_expired',
            detail: { reason: 'lease_expired' },
          }
        : {
            id: job.id,
            from: ACTIVE_STATES,
            to: 'QUEUED',
            attempt: job.attempt,
            requireLeaseExpired: true,
            availableAfterSeconds: retryBackoffSeconds(job.attempt),
            attemptOutcome: 'lease_expired',
            detail: { reason: 'lease_expired' },
          },
      ctx.events.afterCommit,
    );
    if (!res.ok) continue;
    ctx.metrics.leaseExpirations.inc();
    if (exhausted) {
      ctx.metrics.deadLettered.inc();
      stats.deadLettered++;
    } else stats.requeued++;
    log.warn({ executionId: job.id, attempt: job.attempt, deadLettered: exhausted }, 'lease expired');
  }
  if (stats.requeued > 0) await ctx.events.wakeWorkers();

  // 2. Stuck CREATED (API died between insert and queue).
  for (const job of await repo.stuckCreated()) {
    let hasSource: boolean;
    try {
      hasSource = await ctx.storage.exists(s3Keys.manifest(job.tenant_id, job.id));
    } catch {
      continue; // S3 unavailable: decide next pass
    }
    const res = await transitionExecution(
      ctx.pool,
      hasSource
        ? { id: job.id, from: 'CREATED', to: 'QUEUED', detail: { by: 'reconciler' } }
        : { id: job.id, from: 'CREATED', to: 'FAILED', set: { failure_reason: 'artifact_missing' }, detail: { by: 'reconciler' } },
      ctx.events.afterCommit,
    );
    if (res.ok) {
      if (hasSource) stats.createdRecovered++;
      else stats.createdFailed++;
      log.warn({ executionId: job.id, recovered: hasSource }, 'stuck CREATED execution reconciled');
    }
  }

  // 3. Counter healing.
  const healed = await repo.healConcurrency();
  stats.countersHealed = healed.length;
  for (const h of healed) log.warn({ tenantId: h.tenant_id, before: h.before, after: h.after }, 'tenant concurrency healed');

  // 4. Dead workers.
  stats.workersMarkedDead = await repo.markDeadWorkers(30);

  // 5. Retention.
  for (const job of await repo.expiredForRetention(ctx.config.RETENTION_DAYS)) {
    try {
      await ctx.storage.deletePrefix(s3Keys.executionPrefix(job.tenant_id, job.id));
      await repo.deleteExecution(job.id);
      stats.retentionDeleted++;
    } catch {
      break; // try again next pass
    }
  }
  return stats;
}

/** Runs the pass every interval, only on the instance that wins the advisory lock. */
export class Reaper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly ctx: AppContext) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.ctx.config.REAPER_INTERVAL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<ReaperPassStats | null> {
    if (this.running) return null;
    this.running = true;
    let client;
    try {
      client = await this.ctx.pool.connect();
      const lock = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
      if (!lock.rows[0]?.ok) return null;
      try {
        const started = Date.now();
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`reaper pass exceeded ${PASS_TIMEOUT_MS}ms`)), PASS_TIMEOUT_MS);
        });
        try {
          const stats = await Promise.race([runReaperPass(this.ctx), timeout]);
          const ms = Date.now() - started;
          if (ms > 5000) this.ctx.logger.warn({ ms, ...stats }, 'slow reaper pass');
          return stats;
        } finally {
          clearTimeout(timer);
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
      }
    } catch (err) {
      this.ctx.metrics.dbErrors.inc();
      this.ctx.logger.error({ err: (err as Error).message }, 'reaper pass failed');
      return null;
    } finally {
      client?.release();
      this.running = false;
    }
  }
}
