import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { claimFor, drainQueue, finish, newTenant, pyJob, setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeAll(async () => {
  t = await setup();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await drainQueue(t.pool);
});

describe('write and read paths', () => {
  it('submit → worker → SUCCESS with stdout, result, events and files', async () => {
    const c = await newTenant(t);
    const sub = await c.post('/v1/executions', pyJob('print("hi")', { stdin: 'abc' }));
    expect(sub.status).toBe(202);
    expect(sub.body.status).toBe('QUEUED');
    const id = sub.body.id as string;

    const claimed = await claimFor(t, id);
    expect(claimed).not.toBeNull();
    expect(claimed!.job.attempt).toBe(1);
    expect(await finish(t, claimed!.job, claimed!.workerId, { stdout: 'hi\n' })).toBe(true);

    const detail = await c.get(`/v1/executions/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('SUCCESS');
    expect(detail.body.exitCode).toBe(0);
    expect(detail.body.files).toEqual([{ path: 'main.py', bytes: 11 }]);
    expect(detail.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'CREATED',
      'QUEUED',
      'DISPATCHED',
      'STARTING',
      'RUNNING',
      'SUCCESS',
    ]);
    expect(detail.body.attempts).toHaveLength(1);

    const logs = await c.get(`/v1/executions/${id}/logs?stream=stdout&inline=true`);
    expect(logs.status).toBe(200);
    expect(logs.headers['content-type']).toMatch(/text\/plain/);
    expect(logs.headers['x-truncated']).toBe('false');
    expect(logs.text).toBe('hi\n');

    const link = await c.get(`/v1/executions/${id}/logs?stream=stderr`);
    expect(link.status).toBe(200);
    expect(link.body.url).toMatch(/^http/);

    const result = await c.get(`/v1/executions/${id}/result`);
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('SUCCESS');

    const source = await c.get(`/v1/executions/${id}/source`);
    expect(source.body).toMatchObject({ language: 'python', entryFile: 'main.py', stdin: 'abc' });
    expect(source.body.files).toEqual([{ path: 'main.py', content: 'print("hi")' }]);

    const list = await c.get('/v1/executions?status=SUCCESS');
    expect(list.body.items.map((e: { id: string }) => e.id)).toContain(id);

    const usage = await c.get('/v1/usage');
    expect(usage.body.executionsToday).toBeGreaterThanOrEqual(1);
    expect(usage.body.limits.maxConcurrent).toBe(4);
  });

  it('validates input and limits', async () => {
    const c = await newTenant(t);
    const bad = await c.post('/v1/executions', pyJob('x', { files: [{ path: '../evil.py', content: '' }], entryFile: '../evil.py' }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_error');
    expect(bad.body.error.requestId).toBeTruthy();
    const over = await c.post('/v1/executions', pyJob('x', { limits: { timeoutMs: 60_000 } }));
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('limit_exceeded');
    const big = await c.post('/v1/executions', pyJob('x'.repeat(1_100_000)));
    expect(big.status).toBe(413);
    const text = await c.post('/v1/executions').set('Content-Type', 'text/plain').send('hello');
    expect(text.status).toBe(415);
  });

  it('lists with cursor pagination', async () => {
    const c = await newTenant(t);
    for (let i = 0; i < 3; i++) await c.post('/v1/executions', pyJob(`print(${i})`));
    const p1 = await c.get('/v1/executions?limit=2');
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await c.get(`/v1/executions?limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
  });

  it('idempotency: replay returns same execution, different body conflicts', async () => {
    const c = await newTenant(t);
    const headers = { 'Idempotency-Key': 'key-123' };
    const a = await c.post('/v1/executions', pyJob('print(1)'), headers);
    expect(a.status).toBe(202);
    const b = await c.post('/v1/executions', pyJob('print(1)'), headers);
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    const conflict = await c.post('/v1/executions', pyJob('print(2)'), headers);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('idempotency_conflict');
  });

  it('rate limit returns 429 with Retry-After', async () => {
    const c = await newTenant(t);
    await t.pool.query('UPDATE tenants SET max_exec_per_min = 2 WHERE id = $1', [c.me.tenant.id]);
    expect((await c.post('/v1/executions', pyJob())).status).toBe(202);
    expect((await c.post('/v1/executions', pyJob())).status).toBe(202);
    const limited = await c.post('/v1/executions', pyJob());
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('requires CSRF token for cookie-authenticated writes', async () => {
    const c = await newTenant(t);
    const res = await request(t.app.server).post('/v1/executions').set('Cookie', c.cookie).send(pyJob());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_failed');
  });
});

describe('tenant isolation', () => {
  it('other tenants get 404 for executions, logs, result, source, cancel and API keys', async () => {
    const a = await newTenant(t);
    const b = await newTenant(t);
    const id = (await a.post('/v1/executions', pyJob())).body.id as string;
    const claimed = await claimFor(t, id);
    await finish(t, claimed!.job, claimed!.workerId, { stdout: 'secret' });

    for (const path of ['', '/logs?inline=true', '/logs', '/result', '/source']) {
      const res = await b.get(`/v1/executions/${id}${path}`);
      expect(res.status, path).toBe(404);
    }
    expect((await b.post(`/v1/executions/${id}/cancel`)).status).toBe(404);
    expect((await b.get('/v1/executions')).body.items).toHaveLength(0);

    const key = await a.post('/v1/api-keys', { name: 'ci' });
    expect(key.status).toBe(201);
    expect((await b.delete(`/v1/api-keys/${key.body.id}`)).status).toBe(404);
    expect((await b.get('/v1/api-keys')).body.items).toHaveLength(0);
    // Tenant A's key cannot read B's data either.
    const idB = (await b.post('/v1/executions', pyJob())).body.id as string;
    const viaKey = await request(t.app.server).get(`/v1/executions/${idB}`).set('Authorization', `Bearer ${key.body.key}`);
    expect(viaKey.status).toBe(404);
  });

  it('non-uuid ids are 404, not 500', async () => {
    const a = await newTenant(t);
    expect((await a.get('/v1/executions/not-a-uuid')).status).toBe(404);
  });
});

describe('API keys', () => {
  it('create once, authenticate, revoke', async () => {
    const c = await newTenant(t);
    const created = await c.post('/v1/api-keys', { name: 'ci' });
    expect(created.body.key).toMatch(/^ce_live_[a-z0-9]{12}_/);
    const bearer = { Authorization: `Bearer ${created.body.key}` };
    const sub = await request(t.app.server).post('/v1/executions').set(bearer).send(pyJob());
    expect(sub.status).toBe(202);
    const list = await c.get('/v1/api-keys');
    expect(list.body.items[0]).not.toHaveProperty('key');
    expect(list.body.items[0]).not.toHaveProperty('keyHash');
    expect((await c.delete(`/v1/api-keys/${created.body.id}`)).status).toBe(204);
    const after = await request(t.app.server).get('/v1/me').set(bearer);
    expect(after.status).toBe(401);
    const bogus = await request(t.app.server).get('/v1/me').set('Authorization', 'Bearer ce_live_aaaaaaaaaaaa_' + 'x'.repeat(43));
    expect(bogus.status).toBe(401);
  });

  it('SSE rejects API key callers', async () => {
    const c = await newTenant(t);
    const key = (await c.post('/v1/api-keys', { name: 'k' })).body.key;
    const id = (await c.post('/v1/executions', pyJob())).body.id;
    const res = await request(t.app.server).get(`/v1/executions/${id}/events`).set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(400);
  });
});

describe('concurrency and fairness', () => {
  it('tenant at max_concurrent=1 runs one at a time; other tenants are not blocked', async () => {
    const a = await newTenant(t);
    const b = await newTenant(t);
    await t.pool.query('UPDATE tenants SET max_concurrent = 1 WHERE id = $1', [a.me.tenant.id]);
    const a1 = (await a.post('/v1/executions', pyJob('1'))).body.id;
    const a2 = (await a.post('/v1/executions', pyJob('2'))).body.id;
    const b1 = (await b.post('/v1/executions', pyJob('3'))).body.id;

    const first = await t.queue.claim('w1', 30);
    const second = await t.queue.claim('w2', 30);
    const third = await t.queue.claim('w3', 30);
    const claimedIds = [first?.id, second?.id];
    expect(claimedIds).toContain(a1);
    expect(claimedIds).toContain(b1);
    expect(third).toBeNull(); // a2 waits for a1's slot

    await finish(t, first!, 'w1', { stdout: '' });
    await finish(t, second!, 'w2', { stdout: '' });
    const fourth = await t.queue.claim('w4', 30);
    expect(fourth?.id).toBe(a2);
    await finish(t, fourth!, 'w4', { stdout: '' });
  });
});

describe('cancel', () => {
  it('cancels a queued execution directly', async () => {
    const c = await newTenant(t);
    const id = (await c.post('/v1/executions', pyJob())).body.id;
    const res = await c.post(`/v1/executions/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(await t.queue.claim('w', 30)).toBeNull();
    expect((await c.post(`/v1/executions/${id}/cancel`)).status).toBe(409);
  });

  it('cancel while running sets cancel_requested; worker completes CANCELLED', async () => {
    const c = await newTenant(t);
    const id = (await c.post('/v1/executions', pyJob())).body.id;
    const { job, workerId } = (await claimFor(t, id))!;
    await t.queue.advance(job, workerId, 'DISPATCHED', 'STARTING');
    await t.queue.advance(job, workerId, 'STARTING', 'RUNNING');

    const res = await c.post(`/v1/executions/${id}/cancel`);
    expect(res.status).toBe(202);
    expect(res.body.cancelRequested).toBe(true);
    const hb = await t.queue.heartbeat(job, workerId, 30);
    expect(hb).toEqual({ leaseHeld: true, cancelRequested: true });
    expect(
      await t.queue.complete(job, workerId, {
        status: 'CANCELLED',
        exitCode: null,
        termSignal: 'SIGKILL',
        failureReason: null,
        wallMs: 5,
        cpuMs: 1,
        peakMemoryBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
        resultPrefix: null,
      }),
    ).toBe(true);
    expect((await c.get(`/v1/executions/${id}`)).body.status).toBe('CANCELLED');
  });

  it('SSE sends the current state immediately and closes on terminal', async () => {
    const c = await newTenant(t);
    const id = (await c.post('/v1/executions', pyJob())).body.id;
    await c.post(`/v1/executions/${id}/cancel`);
    const res = await c.get(`/v1/executions/${id}/events`).buffer(true).parse((r, cb) => {
      let data = '';
      r.on('data', (chunk: Buffer) => (data += chunk.toString()));
      r.on('end', () => cb(null, data));
    });
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.body as string).toContain('event: status');
    expect(res.body as string).toContain('"status":"CANCELLED"');
  });
});

describe('worker role', () => {
  it('cannot read tables directly', async () => {
    for (const table of ['users', 'api_keys', 'executions', 'tenants']) {
      await expect(t.workerPool.query(`SELECT * FROM ${table} LIMIT 1`)).rejects.toThrow(/permission denied/);
    }
    await expect(t.workerPool.query(`UPDATE executions SET status = 'SUCCESS'`)).rejects.toThrow(/permission denied/);
  });
});

describe('ops', () => {
  it('healthz, readyz, metrics, docs', async () => {
    expect((await request(t.app.server).get('/healthz')).status).toBe(200);
    const ready = await request(t.app.server).get('/readyz');
    expect(ready.body).toMatchObject({ postgres: 'ok', redis: 'ok', s3: 'ok' });
    const metrics = await request(t.app.server).get('/metrics');
    for (const name of [
      'http_requests_total',
      'http_request_duration_seconds',
      'executions_created_total',
      'executions_finished_total',
      'queue_depth',
      'oldest_queued_age_seconds',
      'sandbox_slots_busy',
      'sandbox_slots_total',
      'lease_expirations_total',
      'dead_lettered_total',
      'fenced_results_discarded_total',
      'rate_limited_total',
      's3_errors_total',
      'db_errors_total',
      'redis_errors_total',
    ])
      expect(metrics.text, name).toContain(name);
    const docs = await request(t.app.server).get('/docs');
    expect(docs.body.openapi).toBe('3.0.3');
    expect(docs.body.paths['/v1/executions']).toBeDefined();
    const res = await request(t.app.server).get('/healthz').set('X-Request-Id', 'abc12345-incoming');
    expect(res.headers['x-request-id']).toBe('abc12345-incoming');
  });
});
