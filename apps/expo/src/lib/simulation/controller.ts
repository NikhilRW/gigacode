import { statuses, terminal, type ExecutionDetail, type Me, type Source, type Usage } from '../types';
import { simulationTarget } from './target';
export { simulationOrigin } from './target';

export const SIMULATION_LIMITS = {
  minRate: 0.1,
  maxRate: 1,
  minDurationSeconds: 5,
  maxDurationSeconds: 60,
  maxJobs: 30,
  maxOutstanding: 2,
  pollMs: 2500,
  drainMs: 90_000,
} as const;

// Fixed, small, deterministic Python workload. No user source, input, imports or network.
export const probeSource = (): Source => ({
  language: 'python',
  entryFile: 'simulation_probe.py',
  files: [{ path: 'simulation_probe.py', content: 'checksum = 0\nfor i in range(20000):\n    checksum = (checksum + i * i) % 1000003\nprint("simulation-probe-v1", checksum)\n' }],
  stdin: '',
  network: false,
  limits: { timeoutMs: 1000, memoryMb: 64, cpuMsPerSec: 100, pids: 16 },
});

export interface Plan { rate: number; durationSeconds: number; maxJobs: number }
export interface Attestation { authorizedEnvironment: boolean; dedicatedTenant: boolean; targetOriginConfirmation?: string }
export interface SimulationApi {
  readonly origin: string;
  me(signal: AbortSignal): Promise<Me>;
  usage(signal: AbortSignal): Promise<Usage>;
  create(source: Source): Promise<{ id: string }>;
  execution(id: string, signal: AbortSignal): Promise<ExecutionDetail>;
  cancel(id: string): Promise<void>;
}
export interface Clock {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}
export const systemClock: Clock = {
  now: () => Date.now(),
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

export function validatePlan(plan: Plan, me: Me): string | null {
  const l = SIMULATION_LIMITS;
  if (!Number.isFinite(plan.rate) || plan.rate < l.minRate || plan.rate > l.maxRate)
    return `Rate must be ${l.minRate}–${l.maxRate} requests per second.`;
  if (!Number.isInteger(plan.durationSeconds) || plan.durationSeconds < l.minDurationSeconds || plan.durationSeconds > l.maxDurationSeconds)
    return `Duration must be ${l.minDurationSeconds}–${l.maxDurationSeconds} whole seconds.`;
  if (!Number.isInteger(plan.maxJobs) || plan.maxJobs < 1 || plan.maxJobs > l.maxJobs)
    return `Total attempt cap must be 1–${l.maxJobs}.`;
  if (!Object.values(me.limits).every((value) => Number.isFinite(value) && value > 0))
    return 'Tenant limits are unavailable or invalid.';
  if (plan.rate * 60 > me.limits.maxExecPerMin)
    return `Rate exceeds this tenant's ${me.limits.maxExecPerMin} executions/minute limit.`;
  const source = probeSource();
  if (me.limits.maxConcurrent < 1 || me.limits.maxTimeoutMs < source.limits.timeoutMs ||
      me.limits.maxMemoryMb < source.limits.memoryMb || me.limits.maxSourceBytes < source.files[0].content.length)
    return 'Tenant limits cannot accommodate the fixed 1 s / 64 MiB probe.';
  return null;
}

type Phase = 'idle' | 'validating' | 'running' | 'draining' | 'finished';
type ProbeStatus = ExecutionDetail['status'] | 'SUBMITTING' | 'REJECTED' | 'UNKNOWN';
export interface Probe {
  sequence: number;
  id?: string;
  status: ProbeStatus;
  startedAt: number;
  submissionMs?: number;
  observedEndToEndMs?: number;
  wallMs?: number;
  stale?: boolean;
  cancellation: 'none' | 'pending' | 'requested' | 'failed';
  monitorError?: string;
}
export interface SimulationSnapshot {
  phase: Phase;
  plan: Plan | null;
  reason: string;
  elapsedMs: number;
  cooldownMs: number;
  cooldownUntil: number;
  probes: readonly Probe[];
  usage: Usage | null;
  usageObservedAt: number | null;
  usageError: string | null;
  rateLimited: number;
  issues: readonly string[];
}
const isTerminal = (row: Probe) => statuses.includes(row.status as ExecutionDetail['status']) && terminal(row.status as ExecutionDetail['status']);
const outstanding = (row: Probe) => row.status === 'SUBMITTING' || (!!row.id && !isTerminal(row));
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function simulationMetrics(snapshot: SimulationSnapshot) {
  const rows = snapshot.probes;
  const completed = rows.filter((row) => row.status === 'SUCCESS').length;
  const failed = rows.filter((row) => ['FAILED', 'TIMEOUT', 'DEAD_LETTERED'].includes(row.status)).length;
  const cancelled = rows.filter((row) => row.status === 'CANCELLED').length;
  return {
    attempts: rows.length,
    submitted: rows.filter((row) => !!row.id).length,
    completed,
    failed,
    cancelled,
    rejected: rows.filter((row) => row.status === 'REJECTED').length,
    unknown: rows.filter((row) => row.status === 'UNKNOWN').length,
    submitting: rows.filter((row) => row.status === 'SUBMITTING').length,
    running: rows.filter((row) => row.status === 'RUNNING').length,
    pending: rows.filter((row) => row.id && !isTerminal(row) && row.status !== 'RUNNING').length,
    outstanding: rows.filter(outstanding).length,
    throughput: snapshot.elapsedMs > 0 ? (completed + failed + cancelled) * 1000 / snapshot.elapsedMs : 0,
    submissionMs: mean(rows.flatMap((row) => row.id && row.submissionMs !== undefined ? [row.submissionMs] : [])),
    observedEndToEndMs: mean(rows.flatMap((row) => row.observedEndToEndMs === undefined ? [] : [row.observedEndToEndMs])),
    wallMs: mean(rows.flatMap((row) => row.wallMs === undefined ? [] : [row.wallMs])),
  };
}

export function httpStatus(error: unknown): number {
  return error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 0;
}
export function retryDelay(error: unknown, now: number): number {
  if (error && typeof error === 'object' && 'retryAfter' in error) {
    const value = error.retryAfter;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.max(1000, value * 1000);
    if (typeof value === 'string') {
      const seconds = Number(value);
      if (value.trim() && Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000);
      const date = Date.parse(value);
      if (Number.isFinite(date) && date > now) return date - now;
    }
  }
  // Existing ApiClient does not expose Retry-After. Stop production, pause reads and cleanup.
  return 60_000;
}

/** One explicitly started experiment per instance; POSTs are never retried or aborted. */
export class SimulationController {
  private snapshot: SimulationSnapshot = { phase: 'idle', plan: null, reason: 'Ready. No jobs submitted.', elapsedMs: 0, cooldownMs: 0, cooldownUntil: 0, probes: [], usage: null, usageObservedAt: null, usageError: null, rateLimited: 0, issues: [] };
  private listeners = new Set<() => void>();
  private rows: Probe[] = [];
  private disposed = false;
  private epoch = 0;
  private monitor = new AbortController();
  private timer?: () => void;
  private startedAt = 0;
  private deadline = 0;
  private drainDeadline = 0;
  private nextSubmission = 0;
  private nextPoll = 0;
  private nextUsage = 0;
  private blockedUntil = 0;
  private polling = false;
  private creating = false;
  private pollFailures = 0;
  private monitoringHalted = false;
  private concurrency = 1;
  private identity: Me | null = null;
  private cleanupTimers = new Set<number>();
  private readonly capturedOrigin: string;

  constructor(
    private api: SimulationApi,
    private expected: { tenantId: string; userId: string; browserOrigin?: string | null },
    private clock: Clock = systemClock,
    private reportCleanup: (message: string) => void = (message) => console.warn('Simulation cleanup:', message),
  ) { this.capturedOrigin = api.origin; }

  /** Shared with the passive observer; a read-side 429 also gates preflight and cleanup. */
  deferRequests(until: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, until);
    this.publish({ cooldownUntil: this.blockedUntil, cooldownMs: Math.max(0, this.blockedUntil - this.clock.now()) });
  }

  getSnapshot = (): SimulationSnapshot => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  /** React development effect replay may reattach an entirely idle instance. */
  attach(): () => void {
    if (this.disposed && this.snapshot.phase === 'idle' && this.rows.length === 0) {
      this.disposed = false;
      this.monitor = new AbortController();
    }
    return () => this.dispose();
  }
  private publish(changes: Partial<SimulationSnapshot> = {}) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...changes, probes: this.rows.map((row) => ({ ...row })) };
    for (const listener of this.listeners) listener();
  }
  private issue(message: string) {
    // Never include server error messages, request bodies or credentials in reports.
    if (this.disposed) { this.reportCleanup(message); return; }
    if (!this.snapshot.issues.includes(message)) this.publish({ issues: [...this.snapshot.issues, message] });
  }

  async start(plan: Plan, attestation: Attestation): Promise<void> {
    if (this.disposed || this.snapshot.phase !== 'idle') return;
    const target = simulationTarget(this.capturedOrigin, this.expected.browserOrigin);
    if (target.kind === 'blocked' || this.api.origin !== this.capturedOrigin) {
      this.publish({ reason: target.kind === 'blocked' ? target.label : 'API origin changed. Reopen the screen and confirm the new target.' });
      return;
    }
    if (this.clock.now() < this.blockedUntil) {
      this.publish({ reason: 'Shared rate-limit cooldown is active. No preflight or submissions.' });
      return;
    }
    if (target.kind === 'codespaces' && attestation.targetOriginConfirmation !== target.origin) {
      this.publish({ reason: 'Type the exact current API origin before starting a forwarded Codespaces target.' });
      return;
    }
    if (!attestation.authorizedEnvironment || !attestation.dedicatedTenant) {
      this.publish({ reason: 'Confirm both environment authorization and a dedicated test tenant before starting.' });
      return;
    }
    const selected = { ...plan };
    const version = this.epoch;
    this.publish({ phase: 'validating', reason: 'Checking identity, tenant limits and current activity…' });
    try {
      const me = await this.api.me(this.monitor.signal);
      if (this.disposed || version !== this.epoch || this.getSnapshot().phase !== 'validating') return;
      if (me.tenant.id !== this.expected.tenantId || me.user.id !== this.expected.userId)
        throw new Error('identity');
      if (this.api.origin !== this.capturedOrigin || this.clock.now() < this.blockedUntil) { this.stop('Target changed or shared cooldown began during preflight. Nothing submitted.'); return; }
      const usage = await this.api.usage(this.monitor.signal);
      if (this.disposed || version !== this.epoch || this.getSnapshot().phase !== 'validating') return;
      if (this.api.origin !== this.capturedOrigin || this.clock.now() < this.blockedUntil) { this.stop('Target changed or shared cooldown began during preflight. Nothing submitted.'); return; }
      const caps = { ...me.limits };
      for (const field of Object.keys(caps) as (keyof Me['limits'])[])
        caps[field] = Math.min(caps[field], usage.limits[field]);
      const identity = { ...me, limits: caps };
      const problem = validatePlan(selected, identity);
      if (problem) { this.publish({ phase: 'idle', reason: problem }); return; }
      if (!Number.isFinite(usage.running) || !Number.isFinite(usage.queued) || usage.running !== 0 || usage.queued !== 0) {
        this.publish({ phase: 'idle', reason: 'Tenant must have no running or queued executions. Reconcile History first.' });
        return;
      }
      this.identity = identity;
      this.concurrency = Math.min(SIMULATION_LIMITS.maxOutstanding, Math.floor(caps.maxConcurrent));
      this.startedAt = this.clock.now();
      this.deadline = this.startedAt + selected.durationSeconds * 1000;
      this.nextSubmission = this.startedAt;
      this.nextPoll = this.startedAt + SIMULATION_LIMITS.pollMs;
      this.nextUsage = this.startedAt + 10_000;
      this.publish({ phase: 'running', plan: selected, usage, usageObservedAt: this.clock.now(), usageError: null, reason: 'Real test workload is running.' });
      this.tick();
    } catch (error) {
      if (this.disposed || version !== this.epoch || this.getSnapshot().phase !== 'validating') return;
      if (httpStatus(error) === 429) {
        this.rateLimit(error);
        this.publish({ phase: 'finished', reason: 'Preflight was rate limited. Nothing submitted; do not retry immediately.' });
      } else this.publish({ phase: 'idle', reason: 'Preflight failed. Check session, tenant and API availability. Nothing submitted.' });
    }
  }

  addLoad(): void {
    if (this.disposed || this.snapshot.phase !== 'running' || !this.snapshot.plan || !this.identity) return;
    const plan = { ...this.snapshot.plan, rate: Math.round((this.snapshot.plan.rate + 0.1) * 100) / 100 };
    const problem = validatePlan(plan, this.identity);
    if (problem) { this.issue(`Add load blocked: ${problem}`); return; }
    // Never pull the already-scheduled request forward or extend duration / total budget.
    this.publish({ plan, reason: 'Rate increased by 0.1 req/s; duration and total cap are unchanged.' });
  }

  stop(reason = 'Stopped by you. Cancelling owned active jobs; waiting for final status.'): void {
    if (this.disposed || !['validating', 'running', 'draining'].includes(this.snapshot.phase)) return;
    if (this.snapshot.phase === 'validating') {
      this.epoch++;
      this.monitor.abort();
      this.publish({ phase: 'finished', reason });
      return;
    }
    if (this.snapshot.phase !== 'draining') {
      this.drainDeadline = this.clock.now() + SIMULATION_LIMITS.drainMs;
      this.publish({ phase: 'draining', reason });
    }
    for (const row of this.rows) this.cancelOwned(row);
    this.finishIfDrained();
  }

  /** Invalidates reads and subscribers, but retains in-flight creates for late-ID cleanup. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    this.monitor.abort();
    this.timer?.();
    this.listeners.clear();
    for (const row of this.rows) {
      if (row.status === 'SUBMITTING') this.reportCleanup('A create is still in flight. Its returned ID will be cancelled with the captured client. If no ID is returned, reconcile History.');
      if (row.status === 'UNKNOWN') this.reportCleanup('A submission has no known ID. Reconcile the dedicated tenant in History; cancellation cannot be guaranteed.');
      if (row.cancellation === 'failed') this.reportCleanup(`Cancellation previously failed for owned run ${row.id ?? 'unknown'}. Reconcile History.`);
      this.cancelOwned(row);
    }
  }

  private rateLimit(error: unknown) {
    this.deferRequests(this.clock.now() + retryDelay(error, this.clock.now()));
    this.publish({ rateLimited: this.snapshot.rateLimited + 1, cooldownMs: this.blockedUntil - this.clock.now() });
    this.issue('HTTP 429: production stopped. Reads and cancellation pause for Retry-After, or 60 s when unavailable. No create retry.');
    this.stop('Rate limited. No further jobs will be submitted.');
  }

  private tick = () => {
    if (this.disposed || !['running', 'draining'].includes(this.snapshot.phase)) return;
    const now = this.clock.now();
    if (this.api.origin !== this.capturedOrigin) this.stop('Target changed. No further submissions; reconcile owned IDs.');
    this.publish({ elapsedMs: Math.max(0, now - this.startedAt), cooldownMs: Math.max(0, this.blockedUntil - now) });
    const plan = this.snapshot.plan;
    if (this.snapshot.phase === 'running' && plan && (now >= this.deadline || this.rows.length >= plan.maxJobs))
      this.stop(now >= this.deadline ? 'Duration reached. Draining and cancelling remaining owned jobs.' : 'Total attempt cap reached. Draining remaining owned jobs.');
    if (this.snapshot.phase === 'running' && plan && now >= this.blockedUntil && now >= this.nextSubmission && !this.creating &&
        this.rows.filter(outstanding).length < this.concurrency) {
      this.nextSubmission = now + 1000 / plan.rate; // No catch-up bursts after a delayed timer or backpressure.
      void this.submit();
    }
    if (now >= this.blockedUntil && now >= this.nextPoll && !this.polling && !this.monitoringHalted) {
      this.nextPoll = now + SIMULATION_LIMITS.pollMs;
      void this.poll();
    }
    if (this.snapshot.phase === 'draining') {
      if (now >= this.drainDeadline) {
        this.monitor.abort();
        this.epoch++;
        this.issue('Drain monitoring ended after 90 s. Non-terminal IDs, failed cancellations and unknown submissions need manual reconciliation in History.');
        this.publish({ phase: 'finished', reason: 'Monitoring window ended; unresolved work is not confirmed stopped.' });
      } else this.finishIfDrained();
    }
    if (['running', 'draining'].includes(this.snapshot.phase)) this.timer = this.clock.schedule(this.tick, 250);
  };

  private async submit() {
    this.creating = true;
    const row: Probe = { sequence: this.rows.length + 1, status: 'SUBMITTING', startedAt: this.clock.now(), cancellation: 'none' };
    this.rows.push(row); // Budget includes every attempted POST, including failed / ambiguous requests.
    this.publish();
    try {
      const result = await this.api.create(probeSource()); // Never abort a POST whose ID we still need.
      if (!result || typeof result.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.id) || this.rows.some((other) => other !== row && other.id === result.id))
        throw new Error('invalid-create-response');
      row.id = result.id;
      row.status = 'QUEUED';
      row.submissionMs = Math.max(0, this.clock.now() - row.startedAt);
      if (this.disposed || this.snapshot.phase !== 'running') this.cancelOwned(row);
    } catch (error) {
      const status = httpStatus(error);
      // Transport errors, 5xx and unreadable responses can occur after server commit.
      row.status = status >= 400 && status < 500 ? 'REJECTED' : 'UNKNOWN';
      if (row.status === 'UNKNOWN') this.issue('A create response was lost or ambiguous: a job may exist without a known ID. No retry. Reconcile the dedicated tenant in History.');
      if (status === 429) this.rateLimit(error);
      else this.stop('Submission failed. No retry; reconcile any unknown submission in History.');
    } finally {
      this.creating = false;
      this.publish();
      if (!this.disposed && this.snapshot.phase === 'running' && this.rows.length >= (this.snapshot.plan?.maxJobs ?? 0)) this.stop('Total attempt cap reached. Draining remaining owned jobs.');
      this.finishIfDrained();
    }
  }

  private cancelOwned(row: Probe) {
    if (!row.id || isTerminal(row) || row.cancellation !== 'none' || this.cleanupTimers.has(row.sequence)) return;
    const delay = this.blockedUntil - this.clock.now();
    if (delay > 0) {
      this.cleanupTimers.add(row.sequence);
      this.clock.schedule(() => { this.cleanupTimers.delete(row.sequence); this.cancelOwned(row); }, Math.min(delay, 2_147_483_647));
      return;
    }
    const id = row.id;
    row.cancellation = 'pending';
    this.publish();
    void this.api.cancel(id).then(() => {
      row.cancellation = 'requested'; // Acknowledgement is not a terminal execution status.
    }).catch((error: unknown) => {
      row.cancellation = 'failed';
      this.issue(`Cancellation failed for owned run ${id}. Check its final state in History. No automatic cancel retry.`);
      if (httpStatus(error) === 429) this.rateLimit(error);
    }).finally(() => { this.publish(); this.finishIfDrained(); });
  }

  private async poll() {
    this.polling = true;
    const version = this.epoch;
    const isCurrent = () => !this.disposed && version === this.epoch && !this.monitor.signal.aborted &&
      ['running', 'draining'].includes(this.snapshot.phase);
    try {
      for (const row of this.rows.filter((item) => item.id && !isTerminal(item))) {
        // A concurrent cancellation can establish a cooldown while the previous GET is pending.
        if (!isCurrent() || this.clock.now() < this.blockedUntil) return;
        const value = await this.api.execution(row.id!, this.monitor.signal);
        if (!isCurrent()) return;
        if (value.id !== row.id || value.tenantId !== this.expected.tenantId || !statuses.includes(value.status)) throw new Error('mismatched-execution');
        row.stale = value.stale === true;
        row.monitorError = undefined;
        if (row.stale) continue; // A stale terminal cache must not count as a confirmed outcome.
        row.status = value.status;
        if (terminal(value.status)) {
          row.observedEndToEndMs = Math.max(0, this.clock.now() - row.startedAt);
          if (typeof value.wallMs === 'number' && Number.isFinite(value.wallMs) && value.wallMs >= 0) row.wallMs = value.wallMs;
        }
      }
      if (!isCurrent() || this.clock.now() < this.blockedUntil) return;
      if (this.clock.now() >= this.nextUsage) {
        const usage = await this.api.usage(this.monitor.signal);
        if (!isCurrent()) return;
        this.nextUsage = this.clock.now() + 10_000;
        this.publish({ usage, usageObservedAt: this.clock.now(), usageError: null });
        if (this.identity && this.snapshot.plan) {
          const caps = { ...this.identity.limits };
          for (const field of Object.keys(caps) as (keyof Me['limits'])[])
            caps[field] = Math.min(caps[field], usage.limits[field]);
          this.identity = { ...this.identity, limits: caps };
          if (validatePlan(this.snapshot.plan, this.identity) || caps.maxConcurrent < this.concurrency)
            this.stop('Tenant limits changed. Production stopped conservatively.');
        }
      }
      this.pollFailures = 0;
    } catch (error) {
      if (!isCurrent()) return;
      this.pollFailures++;
      this.publish({ usageError: 'Active monitoring failed; tenant usage is last known data.' });
      for (const row of this.rows.filter(outstanding)) row.monitorError = 'Monitoring unavailable; last known state only.';
      if (httpStatus(error) === 429) this.rateLimit(error);
      else {
        this.issue('Execution monitoring failed. Production stopped; displayed statuses may be out of date.');
        this.stop('Monitoring failed. Cancelling owned jobs; no new submissions.');
        if (this.pollFailures >= 2 || [401, 403].includes(httpStatus(error))) {
          this.monitoringHalted = true;
          this.issue('Automatic monitoring halted after repeated errors or lost authorization. Reconcile History.');
        }
      }
    } finally {
      this.polling = false;
      if (isCurrent()) { this.publish(); this.finishIfDrained(); }
    }
  }

  private finishIfDrained() {
    if (this.disposed || this.snapshot.phase !== 'draining') return;
    if (!this.creating && !this.rows.some(outstanding) && !this.rows.some((row) => row.cancellation === 'pending')) {
      this.timer?.();
      this.publish({ phase: 'finished', elapsedMs: Math.max(0, this.clock.now() - this.startedAt), reason: this.rows.some((row) => row.status === 'UNKNOWN') ? 'Finished tracking known IDs. Unknown submissions still require reconciliation.' : 'All known test executions have a confirmed terminal status.' });
    }
  }
}
