import type { ExecutionStatus, LanguageId, Limits } from '@engine/shared';
import type { Queryable } from './pool.ts';

export interface ClaimedJob {
  id: string;
  tenantId: string;
  language: LanguageId;
  entryFile: string;
  limits: Limits;
  artifactPrefix: string;
  attempt: number;
  cancelRequested: boolean;
}

export interface Completion {
  status: Extract<ExecutionStatus, 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'CANCELLED'>;
  exitCode: number | null;
  termSignal: string | null;
  failureReason: string | null;
  wallMs: number;
  cpuMs: number;
  peakMemoryBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  resultPrefix: string | null;
}

export type HeartbeatResult = { leaseHeld: false } | { leaseHeld: true; cancelRequested: boolean };

/**
 * The job queue as seen by a worker. Backed by the executions table today; kept behind
 * an interface so a broker could replace it later.
 */
export interface JobQueue {
  register(info: { id: string; hostname: string; version: string; slots: number; status: string }): Promise<void>;
  claim(workerId: string, leaseSeconds: number): Promise<ClaimedJob | null>;
  heartbeat(job: ClaimedJob, workerId: string, leaseSeconds: number): Promise<HeartbeatResult>;
  advance(job: ClaimedJob, workerId: string, from: 'DISPATCHED' | 'STARTING', to: 'STARTING' | 'RUNNING'): Promise<boolean>;
  /** Fenced. Returns false when this attempt has lost authority. */
  complete(job: ClaimedJob, workerId: string, result: Completion): Promise<boolean>;
}

export class PgJobQueue implements JobQueue {
  constructor(private readonly db: Queryable) {}

  async register(i: { id: string; hostname: string; version: string; slots: number; status: string }) {
    await this.db.query('SELECT worker_register($1, $2, $3, $4, $5)', [i.id, i.hostname, i.version, i.slots, i.status]);
  }

  async claim(workerId: string, leaseSeconds: number): Promise<ClaimedJob | null> {
    const res = await this.db.query('SELECT * FROM worker_claim($1, $2)', [workerId, leaseSeconds]);
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      tenantId: r.tenant_id,
      language: r.language,
      entryFile: r.entry_file,
      limits: r.limits,
      artifactPrefix: r.artifact_prefix,
      attempt: r.attempt,
      cancelRequested: r.cancel_requested,
    };
  }

  async heartbeat(job: ClaimedJob, workerId: string, leaseSeconds: number): Promise<HeartbeatResult> {
    const res = await this.db.query<{ cancel_requested: boolean }>('SELECT * FROM worker_heartbeat($1, $2, $3, $4)', [
      job.id,
      workerId,
      job.attempt,
      leaseSeconds,
    ]);
    const r = res.rows[0];
    return r ? { leaseHeld: true, cancelRequested: r.cancel_requested } : { leaseHeld: false };
  }

  async advance(job: ClaimedJob, workerId: string, from: string, to: string): Promise<boolean> {
    const res = await this.db.query<{ ok: boolean }>('SELECT worker_advance($1, $2, $3, $4, $5) AS ok', [
      job.id,
      workerId,
      job.attempt,
      from,
      to,
    ]);
    return res.rows[0]!.ok;
  }

  async complete(job: ClaimedJob, workerId: string, r: Completion): Promise<boolean> {
    const res = await this.db.query<{ ok: boolean }>(
      'SELECT worker_complete($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) AS ok',
      [
        job.id,
        workerId,
        job.attempt,
        r.status,
        r.exitCode,
        r.termSignal,
        r.failureReason,
        Math.round(r.wallMs),
        Math.round(r.cpuMs),
        Math.round(r.peakMemoryBytes),
        r.stdoutTruncated,
        r.stderrTruncated,
        r.resultPrefix,
      ],
    );
    return res.rows[0]!.ok;
  }
}
