import { statuses, type Execution, type ExecutionList, type Usage } from '../types';
import { httpStatus, retryDelay, systemClock, type Clock, type SimulationController, type SimulationSnapshot } from './controller';

export const ACTIVITY_POLL_MS = 10_000;
export interface ActivityApi {
  usage(signal: AbortSignal): Promise<Usage>;
  executions(signal: AbortSignal): Promise<ExecutionList>;
}
export interface ActivitySnapshot {
  usage: Usage | null;
  usageAt: number | null;
  executions: readonly Execution[] | null;
  executionsAt: number | null;
  now: number;
  mode: 'paused' | 'loading' | 'polling' | 'cooldown' | 'unauthorized';
  error: string | null;
}
export function validUsage(value: Usage): boolean {
  return [value.executionsToday, value.running, value.queued, value.totalCpuMs].every((n) => Number.isFinite(n) && n >= 0) &&
    (value.successRate24h === null || (Number.isFinite(value.successRate24h) && value.successRate24h >= 0 && value.successRate24h <= 1));
}

/** Read-only, sequential, no overlapping cycles. Constructor is inert; attach starts observation. */
export class TenantActivityObserver {
  private snapshot: ActivitySnapshot;
  private listeners = new Set<() => void>();
  private disposed = true;
  private foreground = false;
  private paused = true;
  private busy = false;
  private unauthorized = false;
  private epoch = 0;
  private nextRead = 0;
  private request?: AbortController;
  private timer?: () => void;
  private unsubscribe?: () => void;

  constructor(private api: ActivityApi, private controller: SimulationController, private tenantId: string, private clock: Clock = systemClock) {
    this.snapshot = { usage: null, usageAt: null, executions: null, executionsAt: null, now: clock.now(), mode: 'paused', error: null };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(changes: Partial<ActivitySnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...changes, now: this.clock.now() };
    for (const listener of this.listeners) listener();
  }
  attach(): () => void {
    this.disposed = false;
    this.unsubscribe?.();
    this.unsubscribe = this.controller.subscribe(this.reconcile);
    this.tick();
    return () => this.dispose();
  }
  setForeground(value: boolean) { this.foreground = value; this.reconcile(); }
  private reconcile = () => {
    if (this.disposed) return;
    const state = this.controller.getSnapshot();
    const pause = !this.foreground || !this.tenantId || ['validating', 'running', 'draining'].includes(state.phase);
    if (pause && !this.paused) { this.epoch++; this.request?.abort(); }
    this.paused = pause;
    const cooling = this.clock.now() < state.cooldownUntil;
    this.publish({ mode: pause ? 'paused' : this.unauthorized ? 'unauthorized' : cooling ? 'cooldown' : this.busy ? 'loading' : 'polling' });
    if (!pause && !cooling && !this.unauthorized && !this.busy && this.clock.now() >= this.nextRead) void this.poll();
  };
  private tick = () => {
    if (this.disposed) return;
    this.reconcile();
    this.timer = this.clock.schedule(this.tick, 1000);
  };
  private async poll() {
    this.busy = true;
    const version = this.epoch;
    const request = new AbortController();
    this.request = request;
    const current = () => !this.disposed && !this.paused && version === this.epoch && !request.signal.aborted && this.clock.now() >= this.controller.getSnapshot().cooldownUntil;
    this.publish({ mode: 'loading' });
    try {
      const usage = await this.api.usage(request.signal);
      if (!current()) return;
      if (!validUsage(usage)) throw new Error('invalid-usage');
      this.publish({ usage, usageAt: this.clock.now() });
      if (!current()) return; // Recheck coordination before *each* GET.
      const list = await this.api.executions(request.signal);
      if (!current()) return;
      if (!Array.isArray(list.items) || list.items.some((row) => row.tenantId !== this.tenantId || !statuses.includes(row.status))) throw new Error('invalid-executions');
      this.publish({ executions: list.items, executionsAt: this.clock.now(), error: null });
    } catch (error) {
      if (this.disposed) return;
      if (httpStatus(error) === 429) {
        this.controller.deferRequests(this.clock.now() + retryDelay(error, this.clock.now()));
        this.publish({ error: 'HTTP 429: shared cooldown. Reads pause for Retry-After, or 60 s when unavailable; no automatic load resume.' });
      } else if (current()) {
        this.unauthorized = [401, 403].includes(httpStatus(error));
        this.publish({ error: this.unauthorized ? 'Observation halted: authorization unavailable. Sign in again.' : 'Tenant observation failed. Last known data only; retrying no sooner than 10 s.' });
      }
    } finally {
      this.busy = false;
      this.nextRead = this.clock.now() + ACTIVITY_POLL_MS;
      this.reconcile();
    }
  }
  dispose() {
    this.disposed = true;
    this.epoch++;
    this.request?.abort();
    this.timer?.();
    this.unsubscribe?.();
    this.listeners.clear();
  }
}

/** Keep measurement scope/freshness explicit; never convert missing data into zero. */
export function tenantTelemetry(activity: ActivitySnapshot, experiment: SimulationSnapshot) {
  const fromExperiment = experiment.usageObservedAt !== null && (activity.usageAt === null || experiment.usageObservedAt > activity.usageAt);
  const usage = fromExperiment ? experiment.usage : activity.usage;
  const at = fromExperiment ? experiment.usageObservedAt : activity.usageAt;
  const active = ['validating', 'running', 'draining'].includes(experiment.phase);
  // A finished experiment's cached usage must not mask a later passive read/auth failure.
  const error = fromExperiment ? experiment.usageError || (!active ? activity.error : null) : activity.error;
  const cooldown = activity.now < experiment.cooldownUntil;
  const fresh = !!usage && validUsage(usage) && at !== null && activity.now - at <= 25_000 && !error && !cooldown && (activity.mode !== 'paused' || active);
  return { usage, at, error, fresh, fromExperiment, cooldown };
}
