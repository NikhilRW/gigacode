import { describe, expect, test } from 'bun:test';
import {
  SIMULATION_LIMITS,
  SimulationController,
  probeSource,
  simulationMetrics,
  simulationOrigin,
  validatePlan,
  type Clock,
  type SimulationApi,
} from '../src/lib/simulation/controller';
import { simulationApi } from '../src/lib/simulation/api';
import { ApiClient } from '../src/lib/client';
import type { ExecutionDetail, Me, Source, Usage } from '../src/lib/types';

class MockClock implements Clock {
  time = 0;
  tasks: { at: number; callback: () => void; cancelled: boolean }[] = [];
  now = () => this.time;
  schedule(callback: () => void, delayMs: number) {
    const task = { at: this.time + delayMs, callback, cancelled: false };
    this.tasks.push(task);
    return () => { task.cancelled = true; };
  }
  async advance(ms: number) {
    const until = this.time + ms;
    for (;;) {
      this.tasks.sort((a, b) => a.at - b.at);
      const task = this.tasks.find((item) => !item.cancelled && item.at <= until);
      if (!task) break;
      task.cancelled = true;
      this.time = task.at;
      task.callback();
      await flush();
    }
    this.time = until;
    await flush();
  }
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const identity = (): Me => ({
  user: { id: 'user-test', email: 'test@example.invalid', name: 'Test', role: 'owner' },
  tenant: { id: 'tenant-test', name: 'Dedicated test' },
  limits: { maxConcurrent: 2, maxExecPerMin: 60, maxTimeoutMs: 5000, maxMemoryMb: 256, maxSourceBytes: 4096 },
});
const runId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const detail = (id: string, status: ExecutionDetail['status'] = 'QUEUED'): ExecutionDetail => ({
  id, tenantId: 'tenant-test', status, language: 'python', entryFile: 'simulation_probe.py',
  attempt: 1, maxAttempts: 1, cancelRequested: false, exitCode: null, termSignal: null,
  failureReason: null, wallMs: null, cpuMs: null, peakMemoryBytes: null,
  stdoutTruncated: false, stderrTruncated: false, createdAt: '2026-01-01T00:00:00Z',
  limits: probeSource().limits, files: [], events: [], attempts: [],
});
class MockApi implements SimulationApi {
  origin = 'http://127.0.0.1:3000';
  identity = identity();
  activity: Usage = { executionsToday: 0, running: 0, queued: 0, totalCpuMs: 0, successRate24h: null, limits: this.identity.limits };
  calls: string[] = [];
  payloads: Source[] = [];
  runs = new Map<string, ExecutionDetail>();
  me = async (_signal: AbortSignal) => { this.calls.push('me'); return this.identity; };
  usage = async (_signal: AbortSignal) => { this.calls.push('usage'); return this.activity; };
  create = async (source: Source) => {
    this.calls.push('create');
    this.payloads.push(source);
    const id = runId(this.payloads.length);
    this.runs.set(id, detail(id));
    return { id };
  };
  execution = async (id: string, _signal: AbortSignal) => {
    this.calls.push(`get:${id}`);
    const value = this.runs.get(id);
    if (!value) throw new Error('missing mock');
    return { ...value };
  };
  cancel = async (id: string) => {
    this.calls.push(`cancel:${id}`);
    const value = this.runs.get(id);
    if (value) value.status = 'CANCELLED';
  };
}
const consent = { authorizedEnvironment: true, dedicatedTenant: true };
const plan = { rate: 0.5, durationSeconds: 30, maxJobs: 10 };
function fixture() {
  const api = new MockApi();
  const clock = new MockClock();
  const reports: string[] = [];
  const controller = new SimulationController(api, { tenantId: 'tenant-test', userId: 'user-test' }, clock, (message) => reports.push(message));
  return { api, clock, controller, reports };
}

describe('simulation guards (no real API / worker calls)', () => {
  test('idle construction, subscription and clock advancement do not perform requests', async () => {
    const { api, clock, controller } = fixture();
    const unsubscribe = controller.subscribe(() => {});
    await clock.advance(100_000);
    expect(controller.getSnapshot().phase).toBe('idle');
    expect(api.calls).toEqual([]);
    expect(simulationMetrics(controller.getSnapshot()).attempts).toBe(0);
    unsubscribe();
    controller.dispose();
  });

  test('idle React effect replay can reattach, without reviving an already-started disposed experiment', async () => {
    const { api, controller } = fixture();
    const cleanup = controller.attach();
    cleanup();
    controller.attach();
    expect(api.calls).toEqual([]);
    await controller.start(plan, consent);
    expect(api.payloads).toHaveLength(1);
    controller.dispose();
    controller.attach();
    await controller.start(plan, consent);
    expect(api.payloads).toHaveLength(1);
  });

  test('only canonical loopback URLs pass; URL normalization cannot turn tricks into authorization', () => {
    for (const url of ['http://localhost:3000', 'https://127.0.0.1/', 'http://[::1]:3000']) expect(simulationOrigin(url)).not.toBeNull();
    for (const url of [
      '', 'https://staging.example.com', 'https://production.example.com', 'http://10.0.2.2:3000',
      'http://192.168.1.2', 'http://localhost.evil.test', 'http://evil.test@localhost',
      'http://localhost@evil.test', 'http://user:password@127.0.0.1', 'http://127.1',
      'http://2130706433', 'http://0x7f000001', 'http://0177.0.0.1', 'http://127.000.000.001',
      'http://127.0.0.2', 'http://localhost.', 'http://LOCALHOST', 'http://%6cocalhost',
      'http://[::ffff:127.0.0.1]', 'http://localhost:99999', 'http://localhost:0',
      'http://localhost:3000/v1', 'http://localhost?target=production', 'http://localhost#fragment',
      ' http://localhost', 'http://local\nhost', 'http:\\localhost', 'file://localhost',
      'http://localhost\\@evil.test', 'http://localhost/../',
    ]) expect(simulationOrigin(url)).toBeNull();
  });

  test('production blocked and both attestations required before even preflight', async () => {
    const { api, controller } = fixture();
    api.origin = 'https://staging.example.com';
    await controller.start(plan, consent);
    api.origin = 'http://localhost:3000';
    await controller.start(plan, { ...consent, dedicatedTenant: false });
    await controller.start(plan, { ...consent, authorizedEnvironment: false });
    expect(api.calls).toEqual([]);
    expect(controller.getSnapshot().phase).toBe('idle');
  });

  test('validates finite hard bounds, integer budgets and tenant resource / rate limits', () => {
    const me = identity();
    expect(validatePlan(plan, me)).toBeNull();
    for (const invalid of [
      { ...plan, rate: 0 }, { ...plan, rate: 1.01 }, { ...plan, rate: NaN }, { ...plan, rate: Infinity },
      { ...plan, durationSeconds: 4 }, { ...plan, durationSeconds: 61 }, { ...plan, durationSeconds: 5.5 },
      { ...plan, maxJobs: 0 }, { ...plan, maxJobs: 31 }, { ...plan, maxJobs: 2.5 },
    ]) expect(validatePlan(invalid, me)).not.toBeNull();
    expect(validatePlan(plan, { ...me, limits: { ...me.limits, maxExecPerMin: 29 } })).not.toBeNull();
    for (const caps of [{ maxConcurrent: 0 }, { maxTimeoutMs: 999 }, { maxMemoryMb: 63 }, { maxSourceBytes: 10 }, { maxExecPerMin: NaN }])
      expect(validatePlan(plan, { ...me, limits: { ...me.limits, ...caps } })).not.toBeNull();
  });

  test('rejects invalid plans, busy tenants, identity mismatches and stricter usage limits without POSTs', async () => {
    for (const change of ['plan', 'busy', 'tenant', 'user', 'limits']) {
      const { api, controller } = fixture();
      if (change === 'busy') api.activity.queued = 1;
      if (change === 'tenant') api.identity.tenant.id = 'other';
      if (change === 'user') api.identity.user.id = 'other';
      if (change === 'limits') api.activity.limits = { ...api.identity.limits, maxExecPerMin: 6 };
      await controller.start(change === 'plan' ? { ...plan, maxJobs: 999 } : plan, consent);
      expect(api.calls).not.toContain('create');
      expect(controller.getSnapshot().phase).toBe('idle');
    }
  });

  test('stop during preflight invalidates its late response', async () => {
    const { api, controller } = fixture();
    const pending = deferred<Me>();
    api.me = () => pending.promise;
    const starting = controller.start(plan, consent);
    controller.stop();
    pending.resolve(identity());
    await starting;
    expect(controller.getSnapshot().phase).toBe('finished');
    expect(api.calls).toEqual([]);
  });
});

describe('bounded scheduling and truthful outcomes', () => {
  test('fixed payload, one create in flight and no retry/catch-up bursts', async () => {
    const { api, controller, clock } = fixture();
    const pending = deferred<{ id: string }>();
    api.create = async (source) => { api.calls.push('create'); api.payloads.push(source); return pending.promise; };
    await controller.start(plan, consent);
    await clock.advance(9000);
    expect(api.payloads).toHaveLength(1);
    expect(api.payloads[0]).toEqual(probeSource());
    expect(api.payloads[0].network).toBe(false);
    api.runs.set(runId(1), detail(runId(1)));
    pending.resolve({ id: runId(1) });
    await flush();
    await clock.advance(250);
    expect(api.payloads).toHaveLength(2); // One request, not the four missed schedule slots.
    await clock.advance(250);
    expect(api.payloads).toHaveLength(2);
    controller.dispose();
  });

  test('rate is spaced and outstanding backpressure uses lower tenant concurrency', async () => {
    const { api, clock, controller } = fixture();
    api.identity.limits.maxConcurrent = 1;
    await controller.start(plan, consent);
    await clock.advance(2250);
    expect(api.payloads).toHaveLength(1);
    api.runs.set(runId(1), { ...detail(runId(1), 'SUCCESS'), wallMs: 20 });
    await clock.advance(500); // Fresh terminal poll, then one new request.
    expect(api.payloads).toHaveLength(2);
    const metrics = simulationMetrics(controller.getSnapshot());
    expect(metrics.completed).toBe(1);
    expect(metrics.wallMs).toBe(20);
    expect(metrics.observedEndToEndMs).toBe(2500);
    expect(metrics.submissionMs).toBe(0);
    expect(metrics.throughput).toBeCloseTo(1000 / 2750);
    await clock.advance(1000);
    expect(api.payloads).toHaveLength(2);
    controller.dispose();
  });

  test('add load preserves the next slot, total cap and duration, and enforces tenant rate', async () => {
    const { api, clock, controller } = fixture();
    await controller.start({ rate: 0.2, durationSeconds: 30, maxJobs: 10 }, consent);
    controller.addLoad();
    expect(controller.getSnapshot().plan).toEqual({ rate: 0.3, durationSeconds: 30, maxJobs: 10 });
    await clock.advance(4750);
    expect(api.payloads).toHaveLength(1);
    await clock.advance(250);
    expect(api.payloads).toHaveLength(2);
    for (let i = 0; i < 20; i++) controller.addLoad();
    expect(controller.getSnapshot().plan?.rate).toBe(1);
    controller.dispose();
    const lower = fixture();
    lower.api.identity.limits.maxExecPerMin = 6;
    await lower.controller.start({ ...plan, rate: 0.1 }, consent);
    lower.controller.addLoad();
    expect(lower.controller.getSnapshot().plan?.rate).toBe(0.1);
    expect(lower.controller.getSnapshot().issues.join(' ')).toContain('Add load blocked');
    lower.controller.dispose();
  });

  test('total attempt cap cannot be exceeded, even after add load or repeated start', async () => {
    const { api, clock, controller } = fixture();
    await controller.start({ ...plan, maxJobs: 2 }, consent);
    await controller.start({ ...plan, maxJobs: 30 }, consent);
    controller.addLoad();
    await clock.advance(20_000);
    expect(api.payloads).toHaveLength(2);
    expect(simulationMetrics(controller.getSnapshot()).attempts).toBe(2);
    expect(controller.getSnapshot().phase).toBe('finished');
    expect(api.calls.filter((call) => call.startsWith('cancel:'))).toHaveLength(2);
  });

  test('duration stops production independently of budget', async () => {
    const { api, clock, controller } = fixture();
    await controller.start({ rate: 0.1, durationSeconds: 5, maxJobs: 30 }, consent);
    await clock.advance(20_000);
    expect(api.payloads).toHaveLength(1);
    expect(controller.getSnapshot().phase).toBe('finished');
  });

  test('counts actual outcomes once, exposes pending/running and ignores stale terminal observations', async () => {
    const { api, clock, controller } = fixture();
    await controller.start(plan, consent);
    await clock.advance(2000);
    api.runs.set(runId(1), { ...detail(runId(1), 'SUCCESS'), stale: true, wallMs: 10 });
    api.runs.set(runId(2), detail(runId(2), 'RUNNING'));
    await clock.advance(500);
    let metrics = simulationMetrics(controller.getSnapshot());
    expect(metrics.completed).toBe(0);
    expect(metrics.pending).toBe(1);
    expect(metrics.running).toBe(1);
    api.runs.set(runId(1), { ...detail(runId(1), 'SUCCESS'), wallMs: 12 });
    api.runs.set(runId(2), { ...detail(runId(2), 'TIMEOUT'), wallMs: 1000 });
    await clock.advance(2500);
    metrics = simulationMetrics(controller.getSnapshot());
    expect(metrics.completed).toBe(1);
    expect(metrics.failed).toBe(1);
    expect(metrics.wallMs).toBe(506);
    await clock.advance(2500);
    expect(simulationMetrics(controller.getSnapshot()).completed).toBe(1);
    expect(api.calls.filter((call) => call === `get:${runId(1)}`)).toHaveLength(2);
    controller.dispose();
  });

  test('a changed tenant limit stops production without claiming enforced isolation', async () => {
    const { api, clock, controller } = fixture();
    await controller.start({ ...plan, rate: 0.2 }, consent);
    api.activity.limits = { ...api.identity.limits, maxExecPerMin: 6 };
    await clock.advance(10_000);
    expect(controller.getSnapshot().phase).toBe('draining');
    expect(controller.getSnapshot().reason).toContain('Tenant limits changed');
    const attempts = api.payloads.length;
    await clock.advance(10_000);
    expect(api.payloads).toHaveLength(attempts);
  });

  test('add load respects newly reduced tenant limits even if the current rate still fits', async () => {
    const { api, clock, controller } = fixture();
    await controller.start({ ...plan, rate: 0.1 }, consent);
    api.activity.limits = { ...api.identity.limits, maxExecPerMin: 6 };
    await clock.advance(10_000);
    expect(controller.getSnapshot().phase).toBe('running');
    controller.addLoad();
    expect(controller.getSnapshot().plan?.rate).toBe(0.1);
    expect(controller.getSnapshot().issues.join(' ')).toContain('Add load blocked');
    controller.dispose();
  });
});

describe('stop, rate limiting and failure cleanup', () => {
  test('stop is immediate for production, idempotent, owns only returned IDs and drains actual final state', async () => {
    const { api, clock, controller } = fixture();
    api.runs.set(runId(99), detail(runId(99))); // Another run is never cancelled or included.
    await controller.start(plan, consent);
    controller.stop();
    controller.stop();
    await flush();
    expect(controller.getSnapshot().phase).toBe('draining');
    expect(simulationMetrics(controller.getSnapshot()).cancelled).toBe(0);
    await clock.advance(20_000);
    expect(api.payloads).toHaveLength(1);
    expect(api.calls.filter((call) => call.startsWith('cancel:'))).toEqual([`cancel:${runId(1)}`]);
    expect(controller.getSnapshot().phase).toBe('finished');
    expect(simulationMetrics(controller.getSnapshot()).cancelled).toBe(1);
  });

  test('late create IDs after Stop are retained and cancelled, not orphaned', async () => {
    const { api, clock, controller } = fixture();
    const pending = deferred<{ id: string }>();
    api.create = async () => { api.calls.push('create'); return pending.promise; };
    await controller.start(plan, consent);
    controller.stop();
    await clock.advance(1000);
    expect(controller.getSnapshot().phase).toBe('draining');
    api.runs.set(runId(1), detail(runId(1)));
    pending.resolve({ id: runId(1) });
    await flush();
    expect(api.calls).toContain(`cancel:${runId(1)}`);
    await clock.advance(2000);
    expect(controller.getSnapshot().phase).toBe('finished');
  });

  test('dispose/auth-origin change invalidates monitors but cleans late IDs with the old captured client', async () => {
    const { api, clock, controller, reports } = fixture();
    const pending = deferred<{ id: string }>();
    api.create = () => pending.promise;
    let notifications = 0;
    controller.subscribe(() => { notifications++; });
    await controller.start(plan, consent);
    const snapshot = controller.getSnapshot();
    controller.dispose();
    const previous = notifications;
    pending.resolve({ id: runId(1) });
    await flush();
    await clock.advance(100_000);
    expect(api.calls).toContain(`cancel:${runId(1)}`);
    expect(notifications).toBe(previous);
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(reports.join(' ')).toContain('create is still in flight');
  });

  test('in-flight GET response cannot update state after disposal', async () => {
    const { api, clock, controller } = fixture();
    const pending = deferred<ExecutionDetail>();
    api.execution = () => pending.promise;
    await controller.start(plan, consent);
    await clock.advance(2500);
    controller.dispose();
    const snapshot = controller.getSnapshot();
    pending.resolve(detail(runId(1), 'SUCCESS'));
    await flush();
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(simulationMetrics(snapshot).completed).toBe(0);
  });

  test('cancellation failure remains visible and never masquerades as cancelled or retries', async () => {
    const { api, clock, controller } = fixture();
    api.cancel = async (id) => { api.calls.push(`cancel:${id}`); throw { status: 503 }; };
    await controller.start(plan, consent);
    controller.stop();
    await flush();
    expect(controller.getSnapshot().probes[0].cancellation).toBe('failed');
    expect(controller.getSnapshot().issues.join(' ')).toContain('Cancellation failed');
    expect(simulationMetrics(controller.getSnapshot()).cancelled).toBe(0);
    api.runs.set(runId(1), detail(runId(1), 'SUCCESS'));
    await clock.advance(5000);
    expect(simulationMetrics(controller.getSnapshot()).completed).toBe(1);
    expect(api.calls.filter((call) => call.startsWith('cancel:'))).toHaveLength(1);
  });

  test('429 POST consumes an attempt, stops permanently and is never retried', async () => {
    const { api, clock, controller } = fixture();
    api.create = async () => { api.calls.push('create'); throw { status: 429 }; };
    await controller.start(plan, consent);
    await clock.advance(120_000);
    expect(api.calls.filter((call) => call === 'create')).toHaveLength(1);
    expect(controller.getSnapshot().rateLimited).toBe(1);
    expect(simulationMetrics(controller.getSnapshot()).attempts).toBe(1);
    expect(simulationMetrics(controller.getSnapshot()).rejected).toBe(1);
    expect(controller.getSnapshot().phase).toBe('finished');
  });

  test('429 monitoring honors exposed Retry-After before cancellation or more reads', async () => {
    const { api, clock, controller } = fixture();
    api.execution = async (id) => { api.calls.push(`get:${id}`); throw { status: 429, retryAfter: '3' }; };
    await controller.start({ ...plan, rate: 0.1 }, consent);
    await clock.advance(2500);
    expect(controller.getSnapshot().phase).toBe('draining');
    const calls = api.calls.length;
    await clock.advance(2750);
    expect(api.calls).toHaveLength(calls);
    expect(api.calls.filter((call) => call.startsWith('cancel:'))).toHaveLength(0);
    await clock.advance(250);
    expect(api.calls).toContain(`cancel:${runId(1)}`);
    expect(api.payloads).toHaveLength(1);
    controller.dispose();
  });

  test('429 without an exposed header pauses owned-job cleanup and reads for 60 seconds', async () => {
    const { api, clock, controller } = fixture();
    let polls = 0;
    const original = api.execution;
    api.execution = async (id, signal) => {
      polls++;
      if (polls === 1) { api.calls.push(`get:${id}`); throw { status: 429 }; }
      return original(id, signal);
    };
    await controller.start({ ...plan, rate: 0.1 }, consent);
    await clock.advance(2500);
    const calls = api.calls.length;
    await clock.advance(59_750);
    expect(api.calls).toHaveLength(calls);
    await clock.advance(250);
    expect(api.calls).toContain(`cancel:${runId(1)}`);
    await clock.advance(2500);
    expect(controller.getSnapshot().phase).toBe('finished');
    expect(api.payloads).toHaveLength(1);
  });

  test('a cancellation 429 during a pending GET pauses the remaining monitor reads until cooldown expires', async () => {
    const { api, clock, controller } = fixture();
    const pending = deferred<ExecutionDetail>();
    const reads: { id: string; at: number }[] = [];
    const original = api.execution;
    api.execution = async (id, signal) => {
      reads.push({ id, at: clock.now() });
      if (reads.length === 1) {
        api.calls.push(`get:${id}`);
        return pending.promise;
      }
      return original(id, signal);
    };
    const cancel = api.cancel;
    api.cancel = async (id) => {
      if (id === runId(1)) { api.calls.push(`cancel:${id}`); throw { status: 429 }; }
      return cancel(id);
    };
    await controller.start(plan, consent);
    await clock.advance(2500); // Two owned jobs; the first GET remains in flight.
    expect(api.payloads).toHaveLength(2);
    expect(reads).toEqual([{ id: runId(1), at: 2500 }]);
    controller.stop();
    await flush(); // Cancellation, not the monitor, establishes the 60 s cooldown.
    expect(controller.getSnapshot().phase).toBe('draining');
    expect(controller.getSnapshot().rateLimited).toBe(1);
    expect(controller.getSnapshot().cooldownMs).toBe(60_000);
    expect(controller.getSnapshot().probes.map((row) => row.cancellation)).toEqual(['failed', 'requested']);
    expect(simulationMetrics(controller.getSnapshot()).cancelled).toBe(0);

    pending.resolve({ ...detail(runId(1), 'SUCCESS'), wallMs: 12 });
    await flush();
    expect(reads).toEqual([{ id: runId(1), at: 2500 }]);
    expect(simulationMetrics(controller.getSnapshot())).toMatchObject({
      completed: 1, cancelled: 0, outstanding: 1, pending: 1, wallMs: 12, observedEndToEndMs: 2500,
    }); // Retain the valid in-flight observation, but not an unconfirmed cancellation.
    const calls = [...api.calls];
    await clock.advance(59_750);
    expect(api.calls).toEqual(calls); // No execution, usage, cancellation or create requests during cooldown.
    expect(controller.getSnapshot().phase).toBe('draining');
    expect(controller.getSnapshot().cooldownMs).toBe(250);
    await clock.advance(250);
    expect(reads).toEqual([{ id: runId(1), at: 2500 }, { id: runId(2), at: 62_500 }]);
    expect(api.calls.filter((call) => call === 'usage')).toHaveLength(2);
    expect(api.calls.filter((call) => call.startsWith('cancel:'))).toHaveLength(2);
    expect(api.payloads).toHaveLength(2);
    expect(controller.getSnapshot().phase).toBe('finished');
    expect(simulationMetrics(controller.getSnapshot())).toMatchObject({ completed: 1, cancelled: 1, outstanding: 0 });
    const finishedCalls = [...api.calls];
    await clock.advance(10_000);
    expect(api.calls).toEqual(finishedCalls);
  });

  test('429 with an HTTP-date Retry-After and disposal retains delayed best-effort cancellation', async () => {
    const { api, clock, controller } = fixture();
    api.execution = async (id) => { api.calls.push(`get:${id}`); throw { status: 429, retryAfter: new Date(8000).toUTCString() }; };
    await controller.start({ ...plan, rate: 0.1 }, consent);
    await clock.advance(2500);
    controller.dispose();
    const snapshot = controller.getSnapshot();
    await clock.advance(5250);
    expect(api.calls.filter((call) => call.startsWith('cancel:'))).toHaveLength(0);
    await clock.advance(250);
    expect(api.calls.filter((call) => call.startsWith('cancel:'))).toEqual([`cancel:${runId(1)}`]);
    expect(controller.getSnapshot()).toBe(snapshot);
  });

  test('preflight 429 submits nothing and lost authorization halts monitoring', async () => {
    const first = fixture();
    first.api.me = async () => { first.api.calls.push('me'); throw { status: 429 }; };
    await first.controller.start(plan, consent);
    expect(first.controller.getSnapshot().phase).toBe('finished');
    expect(first.api.calls).toEqual(['me']);
    expect(first.controller.getSnapshot().rateLimited).toBe(1);
    const second = fixture();
    second.api.execution = async (id) => { second.api.calls.push(`get:${id}`); throw { status: 401 }; };
    await second.controller.start({ ...plan, rate: 0.1 }, consent);
    await second.clock.advance(100_000);
    expect(second.api.calls.filter((call) => call.startsWith('get:'))).toHaveLength(1);
    expect(second.api.payloads).toHaveLength(1);
    expect(second.controller.getSnapshot().issues.join(' ')).toContain('lost authorization');
  });

  test('invalid create responses are unknown, and mismatched monitoring cannot fabricate an outcome', async () => {
    const invalid = fixture();
    invalid.api.create = async () => ({ id: 'not-an-execution-id' });
    await invalid.controller.start(plan, consent);
    await flush();
    expect(simulationMetrics(invalid.controller.getSnapshot()).unknown).toBe(1);
    const mismatch = fixture();
    mismatch.api.execution = async (id) => ({ ...detail(id, 'SUCCESS'), tenantId: 'another-tenant' });
    await mismatch.controller.start({ ...plan, rate: 0.1 }, consent);
    await mismatch.clock.advance(2500);
    expect(simulationMetrics(mismatch.controller.getSnapshot()).completed).toBe(0);
    expect(mismatch.controller.getSnapshot().phase).toBe('draining');
    mismatch.controller.dispose();
  });

  test('lost create responses are explicit unknown work; no unsafe ownership guesses or retry', async () => {
    const { api, clock, controller, reports } = fixture();
    api.create = async () => { api.calls.push('create'); throw new Error('secret server message must not leak'); };
    await controller.start(plan, consent);
    await clock.advance(50_000);
    expect(simulationMetrics(controller.getSnapshot()).unknown).toBe(1);
    expect(api.calls.filter((call) => call === 'create')).toHaveLength(1);
    expect(api.calls.some((call) => call.startsWith('cancel:'))).toBe(false);
    expect(controller.getSnapshot().issues.join(' ')).not.toContain('secret');
    controller.dispose();
    expect(reports.join(' ')).toContain('no known ID');
  });

  test('late rejected creates after dispose report unknown work, with no stale UI publication', async () => {
    const { api, controller, reports } = fixture();
    const pending = deferred<{ id: string }>();
    api.create = () => pending.promise;
    await controller.start(plan, consent);
    controller.dispose();
    const snapshot = controller.getSnapshot();
    pending.reject({ status: 503 });
    await flush();
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(reports.join(' ')).toContain('lost or ambiguous');
  });

  test('bounded draining cannot claim nonterminal jobs are stopped', async () => {
    const { api, clock, controller } = fixture();
    api.cancel = async (id) => { api.calls.push(`cancel:${id}`); };
    await controller.start({ ...plan, rate: 0.1 }, consent);
    controller.stop();
    await clock.advance(SIMULATION_LIMITS.drainMs + 1000);
    expect(controller.getSnapshot().phase).toBe('finished');
    expect(controller.getSnapshot().reason).toContain('not confirmed stopped');
    expect(simulationMetrics(controller.getSnapshot()).pending).toBe(1);
    expect(simulationMetrics(controller.getSnapshot()).cancelled).toBe(0);
    expect(api.calls.filter((call) => call.startsWith('cancel:'))).toHaveLength(1);
  });

  test('repeated monitor errors stop production and automatic reads, with finite drain deadline', async () => {
    const { api, clock, controller } = fixture();
    api.execution = async (id) => { api.calls.push(`get:${id}`); throw { status: 503 }; };
    await controller.start({ ...plan, rate: 0.1 }, consent);
    await clock.advance(100_000);
    expect(api.payloads).toHaveLength(1);
    expect(api.calls.filter((call) => call.startsWith('get:'))).toHaveLength(2);
    expect(controller.getSnapshot().issues.join(' ')).toContain('monitoring halted');
    expect(controller.getSnapshot().phase).toBe('finished');
  });
});

test('adapter uses existing authenticated API contract and captured client only (mock transport)', async () => {
  const calls: { url: string; method?: string; body?: BodyInit | null }[] = [];
  const client = new ApiClient('http://localhost:3000', { token: 'test-only-token', expiresAt: Date.now() + 100_000, baseUrl: 'http://localhost:3000' }, () => {}, async (input, init) => {
    calls.push({ url: String(input), method: init?.method, body: init?.body });
    return new Response(JSON.stringify({ id: runId(1) }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const api = simulationApi(client);
  await api.create(probeSource());
  await api.cancel(runId(1));
  expect(api.origin).toBe('http://localhost:3000');
  expect(calls.map((call) => [call.method, call.url])).toEqual([
    ['POST', 'http://localhost:3000/v1/executions'],
    ['POST', `http://localhost:3000/v1/executions/${runId(1)}/cancel`],
  ]);
  expect(JSON.parse(String(calls[0].body))).toEqual(probeSource());
});
