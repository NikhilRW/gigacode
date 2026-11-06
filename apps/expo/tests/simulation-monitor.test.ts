import { describe, expect, test } from 'bun:test';
import { simulationTarget } from '../src/lib/simulation/target';
import { SimulationController, type Clock, type SimulationApi } from '../src/lib/simulation/controller';
import { ACTIVITY_POLL_MS, TenantActivityObserver, tenantTelemetry, type ActivityApi, type ActivitySnapshot } from '../src/lib/simulation/observer';
import { simulationApi } from '../src/lib/simulation/api';
import { ApiClient } from '../src/lib/client';
import type { Execution, ExecutionList, Me, Usage } from '../src/lib/types';

const pageOrigin = 'https://gentle-space-abc123-8081.app.github.dev';
const apiOrigin = 'https://gentle-space-abc123-3000.app.github.dev';

async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
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
const identity: Me = {
  user: { id: 'user-test', email: 'test@example.invalid', name: 'Test', role: 'owner' },
  tenant: { id: 'tenant-test', name: 'Dedicated test' },
  limits: { maxConcurrent: 2, maxExecPerMin: 60, maxTimeoutMs: 5000, maxMemoryMb: 256, maxSourceBytes: 4096 },
};
const usage = (): Usage => ({ executionsToday: 3, running: 1, queued: 2, totalCpuMs: 42, successRate24h: 0.5, limits: identity.limits });
const execution = (): Execution => ({
  id: '00000000-0000-4000-8000-000000000001', tenantId: identity.tenant.id,
  language: 'python', entryFile: 'test.py', status: 'RUNNING', attempt: 1, maxAttempts: 1,
  cancelRequested: false, exitCode: null, termSignal: null, failureReason: null,
  wallMs: null, cpuMs: null, peakMemoryBytes: null, stdoutTruncated: false, stderrTruncated: false,
  createdAt: '2026-01-01T00:00:00Z', limits: { timeoutMs: 1000, memoryMb: 64 },
});
const plan = { rate: 0.1, durationSeconds: 5, maxJobs: 1 };
const consent = { authorizedEnvironment: true, dedicatedTenant: true, targetOriginConfirmation: apiOrigin };
function fixture(origin = apiOrigin, browserOrigin: string | null = pageOrigin, tenantId = identity.tenant.id) {
  const clock = new MockClock();
  const calls: string[] = [];
  const api: SimulationApi & ActivityApi = {
    origin,
    me: async () => { calls.push('me'); return identity; },
    usage: async () => { calls.push('usage'); return usage(); },
    executions: async () => { calls.push('executions'); return { items: [execution()], nextCursor: null }; },
    create: async () => { calls.push('create'); return { id: execution().id }; },
    execution: async () => { calls.push('execution'); return { ...execution(), status: 'CANCELLED', files: [], events: [], attempts: [] }; },
    cancel: async () => { calls.push('cancel'); },
  };
  const controller = new SimulationController(api, { tenantId, userId: identity.user.id, browserOrigin }, clock, () => {});
  const observer = new TenantActivityObserver(api, controller, tenantId, clock);
  const observe = () => { observer.attach(); observer.setForeground(true); };
  const dispose = () => { observer.dispose(); controller.dispose(); };
  return { api, clock, calls, controller, observer, observe, dispose };
}

describe('Codespaces target boundaries (no network)', () => {
  test('allows different forwarded ports only in the same canonical workspace', () => {
    expect(simulationTarget(apiOrigin, pageOrigin)).toEqual({
      kind: 'codespaces', origin: apiOrigin, workspace: 'gentle-space-abc123', label: 'Matching Codespaces workspace',
    });
    expect(simulationTarget(`${apiOrigin}/`, pageOrigin).origin).toBe(apiOrigin);
  });

  test('blocks absent, native, local and mismatched browser origins', () => {
    for (const page of [null, '', 'http://localhost:8081', 'https://other-space-8081.app.github.dev', 'https://example.com'])
      expect(simulationTarget(apiOrigin, page).kind).toBe('blocked');
  });

  test('rejects forwarded origin lookalikes and normalization tricks on either side', () => {
    for (const origin of [
      'http://gentle-space-abc123-3000.app.github.dev',
      `${apiOrigin}.evil.test`, `${apiOrigin}:443`, `${apiOrigin}/v1`, `${apiOrigin}/../`,
      `${apiOrigin}?target=local`, `${apiOrigin}#fragment`, ` ${apiOrigin}`,
      'https://user@gentle-space-abc123-3000.app.github.dev',
      'https://gentle-space-abc123-3000.app.github.dev@evil.test',
      'https://GENTLE-space-abc123-3000.app.github.dev',
      'https://gentle-space-abc123-03000.app.github.dev',
      'https://gentle-space-abc123-0.app.github.dev',
      'https://gentle-space-abc123-65536.app.github.dev',
      'https://gentle-space-abc123-3000.app.github.dev.',
      'https://gentle-space-abc123-3000.app.github.dev\\@evil.test',
      `https://${'a'.repeat(64)}-3000.app.github.dev`,
    ]) {
      expect(simulationTarget(origin, pageOrigin).kind).toBe('blocked');
      expect(simulationTarget(apiOrigin, origin).kind).toBe('blocked');
    }
  });

  test('loopback remains independently supported and canonical-only', () => {
    expect(simulationTarget('http://localhost:3000', pageOrigin).kind).toBe('loopback');
    for (const origin of ['http://127.1:3000', 'http://LOCALHOST:3000', 'http://localhost:03000', 'http://localhost:65536'])
      expect(simulationTarget(origin, pageOrigin).kind).toBe('blocked');
  });
});

describe('forwarded load preflight (mock API only)', () => {
  test('requires exact normalized typed origin and both attestations before any request', async () => {
    for (const targetOriginConfirmation of [undefined, '', `${apiOrigin}/`, pageOrigin, apiOrigin.toUpperCase(), ` ${apiOrigin}`, `${apiOrigin} `]) {
      const f = fixture();
      await f.controller.start(plan, { ...consent, targetOriginConfirmation });
      expect(f.calls).toEqual([]);
      expect(f.controller.getSnapshot().phase).toBe('idle');
      f.dispose();
    }
    for (const missing of [{ authorizedEnvironment: false }, { dedicatedTenant: false }]) {
      const f = fixture();
      await f.controller.start(plan, { ...consent, ...missing });
      expect(f.calls).toEqual([]);
      f.dispose();
    }
    const f = fixture(`${apiOrigin}/`);
    f.api.usage = async () => { f.calls.push('usage'); return { ...usage(), running: 0, queued: 0 }; };
    await f.controller.start(plan, consent);
    await flush();
    expect(f.calls.slice(0, 3)).toEqual(['me', 'usage', 'create']);
    f.dispose();
  });

  test('matching typed API origin cannot authorize a missing or different browser workspace', async () => {
    for (const browser of [null, 'http://localhost:8081', 'https://other-space-8081.app.github.dev']) {
      const f = fixture(apiOrigin, browser);
      await f.controller.start(plan, consent);
      expect(f.calls).toEqual([]);
      f.dispose();
    }
  });

  test('origin changes or a shared cooldown between preflight GETs prevent all POSTs', async () => {
    for (const change of ['origin', 'cooldown']) {
      const f = fixture();
      const pending = deferred<Me>();
      f.api.me = async () => { f.calls.push('me'); return pending.promise; };
      const starting = f.controller.start(plan, consent);
      if (change === 'origin') Object.defineProperty(f.api, 'origin', { value: 'http://localhost:3000' });
      else f.controller.deferRequests(5000);
      pending.resolve(identity);
      await starting;
      expect(f.calls).toEqual(['me']);
      expect(f.controller.getSnapshot().phase).toBe('finished');
      f.dispose();
    }
  });
});

describe('passive tenant observer (deterministic clock, no network)', () => {
  test('construction is inert; focused idle observation uses sequential GETs at conservative intervals', async () => {
    const f = fixture('https://production.example.invalid'); // Remote reads do not authorize load.
    f.observer.subscribe(() => {});
    await f.clock.advance(1000);
    expect(f.calls).toEqual([]);
    f.observer.attach();
    await flush();
    expect(f.calls).toEqual([]);
    f.observer.setForeground(true);
    await flush();
    expect(f.calls).toEqual(['usage', 'executions']);
    expect(f.observer.getSnapshot()).toMatchObject({ usage: usage(), executions: [execution()], usageAt: 1000, executionsAt: 1000, mode: 'polling' });
    expect(f.controller.getSnapshot().probes).toEqual([]);
    await f.clock.advance(ACTIVITY_POLL_MS - 1);
    expect(f.calls).toHaveLength(2);
    await f.clock.advance(1);
    expect(f.calls).toEqual(['usage', 'executions', 'usage', 'executions']);
    f.dispose();
  });

  test('slow reads never overlap cycles and wait ten seconds after completion', async () => {
    const f = fixture();
    const pendingUsage = deferred<Usage>();
    const pendingList = deferred<ExecutionList>();
    f.api.usage = async () => { f.calls.push('usage'); return pendingUsage.promise; };
    f.api.executions = async () => { f.calls.push('executions'); return pendingList.promise; };
    f.observe();
    await f.clock.advance(30_000);
    expect(f.calls).toEqual(['usage']);
    pendingUsage.resolve(usage());
    await flush();
    expect(f.calls).toEqual(['usage', 'executions']);
    await f.clock.advance(30_000);
    expect(f.calls).toHaveLength(2);
    pendingList.resolve({ items: [], nextCursor: null });
    await flush();
    await f.clock.advance(9999);
    expect(f.calls).toHaveLength(2);
    await f.clock.advance(1);
    expect(f.calls).toHaveLength(4);
    f.dispose();
  });

  test('missing tenant never observes even in foreground', async () => {
    const f = fixture(apiOrigin, pageOrigin, '');
    f.observe();
    await f.clock.advance(30_000);
    expect(f.calls).toEqual([]);
    expect(f.observer.getSnapshot().mode).toBe('paused');
    f.dispose();
  });

  test('backgrounding aborts pending reads and suppresses late results and the second GET', async () => {
    const f = fixture();
    const pending = deferred<Usage>();
    const signals: AbortSignal[] = [];
    f.api.usage = async (signal) => { f.calls.push('usage'); signals.push(signal); return pending.promise; };
    f.observe();
    f.observer.setForeground(false);
    expect(signals[0].aborted).toBe(true);
    pending.resolve(usage());
    await flush();
    await f.clock.advance(30_000);
    expect(f.calls).toEqual(['usage']);
    expect(f.observer.getSnapshot()).toMatchObject({ mode: 'paused', usage: null, executions: null });
    f.api.usage = async () => { f.calls.push('usage'); return usage(); };
    f.observer.setForeground(true);
    await flush();
    expect(f.calls).toEqual(['usage', 'usage', 'executions']);
    f.dispose();
  });

  test('pausing between usage and list prevents the second GET', async () => {
    const f = fixture();
    f.observer.subscribe(() => {
      const state = f.observer.getSnapshot();
      if (state.usageAt !== null && state.mode !== 'paused') f.observer.setForeground(false);
    });
    f.observe();
    await flush();
    expect(f.calls).toEqual(['usage']);
    expect(f.observer.getSnapshot().executions).toBeNull();
    f.dispose();
  });

  test('disposal on auth/origin replacement aborts and invalidates the old list response', async () => {
    const f = fixture();
    const pending = deferred<ExecutionList>();
    const signals: AbortSignal[] = [];
    f.api.executions = async (signal) => { f.calls.push('executions'); signals.push(signal); return pending.promise; };
    f.observe();
    await flush();
    f.dispose();
    const snapshot = f.observer.getSnapshot();
    expect(signals[0].aborted).toBe(true);
    pending.resolve({ items: [execution()], nextCursor: null });
    await flush();
    await f.clock.advance(30_000);
    expect(f.observer.getSnapshot()).toBe(snapshot);
    expect(snapshot.executions).toBeNull();
    expect(f.calls).toEqual(['usage', 'executions']);
    const replacement = fixture('https://other.example.invalid');
    replacement.observe();
    await flush();
    expect(replacement.observer.getSnapshot().executions).toEqual([execution()]);
    replacement.dispose();
  });

  test('React effect replay remains observable without publishing the abandoned response', async () => {
    const f = fixture();
    const pending = deferred<Usage>();
    f.api.usage = async () => { f.calls.push('usage'); return pending.promise; };
    const detach = f.observer.attach();
    f.observer.setForeground(true);
    detach();
    f.observer.attach();
    pending.resolve(usage());
    await flush();
    expect(f.observer.getSnapshot().usage).toBeNull();
    expect(f.calls).toEqual(['usage']);
    await f.clock.advance(ACTIVITY_POLL_MS);
    expect(f.calls).toEqual(['usage', 'usage', 'executions']);
    expect(f.observer.getSnapshot().usage).toEqual(usage());
    f.dispose();
  });

  test('preflight, running and draining pause passive reads without orphaning late usage', async () => {
    const f = fixture();
    const oldRead = deferred<Usage>();
    const preflight = deferred<Me>();
    const signals: AbortSignal[] = [];
    f.api.usage = async (signal) => { f.calls.push('usage'); signals.push(signal); return oldRead.promise; };
    f.api.me = async () => { f.calls.push('me'); return preflight.promise; };
    f.observe();
    const starting = f.controller.start(plan, consent);
    expect(f.controller.getSnapshot().phase).toBe('validating');
    expect(signals[0].aborted).toBe(true);
    oldRead.resolve(usage());
    await flush();
    expect(f.observer.getSnapshot().usage).toBeNull();
    f.api.usage = async () => { f.calls.push('usage'); return { ...usage(), running: 0, queued: 0 }; };
    preflight.resolve(identity);
    await starting;
    await flush();
    expect(f.controller.getSnapshot().phase).toBe('draining'); // One-attempt budget, then owned cleanup.
    expect(f.observer.getSnapshot().mode).toBe('paused');
    expect(f.calls.filter((call) => call === 'executions')).toHaveLength(0);
    await f.clock.advance(3000);
    expect(f.controller.getSnapshot().phase).toBe('finished');
    await f.clock.advance(10_000);
    expect(f.calls.filter((call) => call === 'executions')).toHaveLength(1);
    expect(f.calls.filter((call) => call === 'create')).toHaveLength(1);
    f.dispose();
  });

  test('401 and 403 halt passive retries until a new observer/session exists', async () => {
    for (const status of [401, 403]) {
      const f = fixture();
      f.api.usage = async () => { f.calls.push('usage'); throw { status }; };
      f.observe();
      await flush();
      expect(f.observer.getSnapshot().mode).toBe('unauthorized');
      f.observer.setForeground(false);
      f.observer.setForeground(true);
      await f.clock.advance(60_000);
      expect(f.calls).toEqual(['usage']);
      expect(f.observer.getSnapshot().error).not.toBeNull();
      f.dispose();
    }
  });

  test('transient read errors retain last known data and retry no sooner than ten seconds', async () => {
    const f = fixture();
    f.observe();
    await flush();
    f.api.usage = async () => { f.calls.push('usage'); throw new Error('private server message'); };
    await f.clock.advance(ACTIVITY_POLL_MS);
    expect(f.observer.getSnapshot().usage).toEqual(usage());
    expect(f.observer.getSnapshot().error).not.toContain('private');
    expect(tenantTelemetry(f.observer.getSnapshot(), f.controller.getSnapshot()).fresh).toBe(false);
    await f.clock.advance(9999);
    expect(f.calls).toHaveLength(3);
    f.api.usage = async () => { f.calls.push('usage'); return usage(); };
    await f.clock.advance(1);
    expect(f.calls).toHaveLength(5);
    expect(f.observer.getSnapshot().error).toBeNull();
    f.dispose();
  });

  test('invalid usage and cross-tenant lists never replace valid observations', async () => {
    for (const invalid of [{ running: -1 }, { queued: NaN }, { executionsToday: Infinity }, { totalCpuMs: -1 }, { successRate24h: 1.1 }]) {
      const f = fixture();
      f.api.usage = async () => ({ ...usage(), ...invalid });
      f.observe();
      await flush();
      expect(f.observer.getSnapshot().usage).toBeNull();
      expect(f.calls).not.toContain('executions');
      expect(f.observer.getSnapshot().error).not.toBeNull();
      f.dispose();
    }
    const f = fixture();
    f.observe();
    await flush();
    f.api.executions = async () => ({ items: [{ ...execution(), tenantId: 'different-tenant' }], nextCursor: null });
    await f.clock.advance(ACTIVITY_POLL_MS);
    expect(f.observer.getSnapshot().executions).toEqual([execution()]);
    expect(f.observer.getSnapshot().executionsAt).toBe(0);
    expect(f.observer.getSnapshot().error).not.toBeNull();
    f.dispose();
  });

  test('observer 429 gates Start and both passive GETs until shared Retry-After expires', async () => {
    const f = fixture();
    f.api.executions = async () => { f.calls.push('executions'); throw { status: 429, retryAfter: '3' }; };
    f.observe();
    await flush();
    expect(f.controller.getSnapshot().cooldownUntil).toBe(3000);
    expect(f.observer.getSnapshot().mode).toBe('cooldown');
    await f.controller.start(plan, consent);
    expect(f.calls).toEqual(['usage', 'executions']);
    await f.clock.advance(2999);
    expect(f.calls).toHaveLength(2);
    f.api.executions = async () => { f.calls.push('executions'); return { items: [], nextCursor: null }; };
    await f.clock.advance(7001); // Ten-second observer cadence is stricter than this cooldown.
    expect(f.calls).toEqual(['usage', 'executions', 'usage', 'executions']);
    expect(f.calls).not.toContain('create');
    f.dispose();
  });

  test('missing Retry-After defaults to 60 seconds without auto-starting load', async () => {
    const f = fixture();
    f.api.usage = async () => { f.calls.push('usage'); throw { status: 429 }; };
    f.observe();
    await flush();
    expect(f.controller.getSnapshot().cooldownUntil).toBe(60_000);
    f.api.usage = async () => { f.calls.push('usage'); return usage(); };
    await f.clock.advance(59_999);
    expect(f.calls).toEqual(['usage']);
    await f.clock.advance(1);
    expect(f.calls).toEqual(['usage', 'usage', 'executions']);
    expect(f.controller.getSnapshot().phase).toBe('idle');
    f.dispose();
  });

  test('controller cooldown invalidates pending observer usage before the list request', async () => {
    const f = fixture();
    const pending = deferred<Usage>();
    f.api.usage = async () => { f.calls.push('usage'); return pending.promise; };
    f.observe();
    f.controller.deferRequests(30_000);
    pending.resolve(usage());
    await flush();
    expect(f.observer.getSnapshot().usage).toBeNull();
    await f.clock.advance(29_999);
    expect(f.calls).toEqual(['usage']);
    await f.clock.advance(1);
    expect(f.calls).toEqual(['usage', 'usage', 'executions']);
    f.dispose();
  });
});

describe('truthful tenant telemetry', () => {
  function activity(): ActivitySnapshot {
    return { usage: usage(), usageAt: 1000, executions: [], executionsAt: 1000, now: 2000, mode: 'polling', error: null };
  }

  test('missing, expired, paused, errored and cooling measurements are never live zeroes', () => {
    const f = fixture();
    const experiment = f.controller.getSnapshot();
    expect(tenantTelemetry(activity(), experiment).fresh).toBe(true);
    for (const invalid of [
      { usage: null }, { usageAt: null }, { now: 26_001 }, { mode: 'paused' as const }, { error: 'unavailable' },
    ]) expect(tenantTelemetry({ ...activity(), ...invalid }, experiment).fresh).toBe(false);
    expect(tenantTelemetry(activity(), { ...experiment, cooldownUntil: 3000 }).fresh).toBe(false);
    expect(tenantTelemetry({ ...activity(), usage: null, usageAt: null }, experiment).usage).toBeNull();
    f.dispose();
  });

  test('active-controller snapshots replace older tenant observations but remain tenant-wide', () => {
    const f = fixture();
    const experiment = { ...f.controller.getSnapshot(), phase: 'running' as const, usage: { ...usage(), running: 7 }, usageObservedAt: 1500 };
    const combined = tenantTelemetry({ ...activity(), mode: 'paused' }, experiment);
    expect(combined).toMatchObject({ fresh: true, fromExperiment: true, at: 1500, usage: { running: 7 } });
    expect(experiment.probes).toEqual([]); // No inference that these seven runs belong to the experiment.
    expect(tenantTelemetry({ ...activity(), usageAt: 1700 }, experiment).fromExperiment).toBe(false);
    expect(tenantTelemetry(activity(), { ...experiment, usageError: 'active read failed' }).fresh).toBe(false);
    f.dispose();
  });

  test('authorization or read errors after an experiment invalidate its newer cached usage', () => {
    const f = fixture();
    const experiment = { ...f.controller.getSnapshot(), phase: 'finished' as const, usage: usage(), usageObservedAt: 1500 };
    for (const mode of ['unauthorized', 'polling'] as const) {
      const result = tenantTelemetry({ ...activity(), mode, error: 'Current tenant observation unavailable' }, experiment);
      expect(result.usage).toEqual(usage());
      expect(result.fresh).toBe(false);
      expect(result.error).not.toBeNull();
    }
    f.dispose();
  });
});

test('observer adapter uses authenticated GETs, bounded list and abort signals (mock transport)', async () => {
  const calls: { url: string; method?: string; signal?: AbortSignal | null; authorization: string | null }[] = [];
  const pending = deferred<Response>();
  const client = new ApiClient(apiOrigin, { token: 'mock-only-token', expiresAt: Date.now() + 100_000, baseUrl: apiOrigin }, () => {}, async (input, init) => {
    calls.push({ url: String(input), method: init?.method, signal: init?.signal, authorization: new Headers(init?.headers).get('authorization') });
    if (String(input).includes('/executions')) return pending.promise;
    return new Response(JSON.stringify(usage()), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const api = simulationApi(client);
  const request = new AbortController();
  await api.usage(request.signal);
  const listing = api.executions(request.signal);
  await flush();
  request.abort();
  expect(calls[1].signal?.aborted).toBe(true);
  pending.resolve(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200, headers: { 'content-type': 'application/json' } }));
  await listing;
  expect(calls.map((call) => [call.method, call.url])).toEqual([
    ['GET', `${apiOrigin}/v1/usage`], ['GET', `${apiOrigin}/v1/executions?limit=8`],
  ]);
  expect(calls.every((call) => call.authorization === 'Bearer mock-only-token')).toBe(true);
});
