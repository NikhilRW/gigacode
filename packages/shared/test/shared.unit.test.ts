import { describe, expect, it } from 'vitest';
import {
  EXECUTION_STATES,
  canTransition,
  createExecutionSchema,
  isSafeRelativePath,
  requestHash,
  resolveLimits,
  retryBackoffSeconds,
} from '../src/index.ts';

describe('state machine', () => {
  it('allows the documented transitions', () => {
    expect(canTransition('CREATED', 'QUEUED')).toBe(true);
    expect(canTransition('CREATED', 'FAILED')).toBe(true);
    expect(canTransition('QUEUED', 'DISPATCHED')).toBe(true);
    expect(canTransition('QUEUED', 'CANCELLED')).toBe(true);
    expect(canTransition('DISPATCHED', 'QUEUED')).toBe(true);
    expect(canTransition('STARTING', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'TIMEOUT')).toBe(true);
    expect(canTransition('RUNNING', 'QUEUED')).toBe(true);
  });
  it('rejects illegal transitions', () => {
    expect(canTransition('CREATED', 'RUNNING')).toBe(false);
    expect(canTransition('QUEUED', 'SUCCESS')).toBe(false);
    expect(canTransition('DISPATCHED', 'SUCCESS')).toBe(false);
    expect(canTransition('DISPATCHED', 'FAILED')).toBe(false);
  });
  it('terminal states have no exits except DLQ requeue', () => {
    for (const s of ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'] as const)
      for (const t of EXECUTION_STATES) expect(canTransition(s, t)).toBe(false);
    expect(canTransition('DEAD_LETTERED', 'QUEUED')).toBe(true);
    expect(canTransition('DEAD_LETTERED', 'RUNNING')).toBe(false);
  });
});

describe('path sanitization', () => {
  it.each(['main.py', 'src/util.py', 'a-b_c.1.js'])('accepts %s', (p) => expect(isSafeRelativePath(p)).toBe(true));
  it.each(['', '/etc/passwd', '../x', 'a/../b', 'a//b', 'a\0b', 'a\\b', './a', '~/x', 'a b'])('rejects %j', (p) =>
    expect(isSafeRelativePath(p)).toBe(false),
  );
});

describe('request validation', () => {
  const base = { language: 'python', files: [{ path: 'main.py', content: 'print(1)' }], entryFile: 'main.py' };
  it('accepts a minimal request and fills defaults', () => {
    const parsed = createExecutionSchema.parse(base);
    expect(parsed.stdin).toBe('');
    expect(parsed.limits).toEqual({});
  });
  it('rejects bad input', () => {
    expect(createExecutionSchema.safeParse({ ...base, language: 'ruby' }).success).toBe(false);
    expect(createExecutionSchema.safeParse({ ...base, entryFile: 'other.py' }).success).toBe(false);
    expect(createExecutionSchema.safeParse({ ...base, files: [base.files[0], base.files[0]] }).success).toBe(false);
    expect(createExecutionSchema.safeParse({ ...base, files: [{ path: '../x.py', content: '' }] }).success).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => ({ path: `f${i}.py`, content: '' }));
    expect(createExecutionSchema.safeParse({ ...base, files: many, entryFile: 'f0.py' }).success).toBe(false);
    expect(createExecutionSchema.safeParse({ ...base, stdin: 'x'.repeat(256 * 1024 + 1) }).success).toBe(false);
    expect(createExecutionSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe('limit clamping', () => {
  const caps = { maxTimeoutMs: 10_000, maxMemoryMb: 512 };
  it('fills defaults', () => {
    expect(resolveLimits({}, caps)).toEqual({
      ok: true,
      limits: { timeoutMs: 5000, memoryMb: 256, cpuMsPerSec: 1000, pids: 64 },
    });
  });
  it('rejects values above caps instead of clamping', () => {
    expect(resolveLimits({ timeoutMs: 20_000 }, caps)).toEqual({ ok: false, field: 'timeoutMs', max: 10_000 });
    expect(resolveLimits({ memoryMb: 300 }, { maxTimeoutMs: 1000, maxMemoryMb: 256 })).toEqual({
      ok: false,
      field: 'memoryMb',
      max: 256,
    });
    expect(resolveLimits({ pids: 65 }, caps)).toEqual({ ok: false, field: 'pids', max: 64 });
  });
  it('defaults never exceed a tenant cap', () => {
    expect(resolveLimits({}, { maxTimeoutMs: 2000, maxMemoryMb: 128 })).toEqual({
      ok: true,
      limits: { timeoutMs: 2000, memoryMb: 128, cpuMsPerSec: 1000, pids: 64 },
    });
  });
});

describe('idempotency hashing', () => {
  it('is independent of key order', () => {
    expect(requestHash({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(requestHash({ b: { d: [1, 2], c: 2 }, a: 1 }));
  });
  it('differs for different content', () => {
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
  });
});

describe('backoff', () => {
  it('uses 5s, 20s, 60s and caps', () => {
    expect([1, 2, 3, 4].map(retryBackoffSeconds)).toEqual([5, 20, 60, 60]);
  });
});
