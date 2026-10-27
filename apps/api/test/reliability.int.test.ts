import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { s3Keys } from '@engine/shared';
import { runReaperPass } from '../src/reaper.ts';
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

const expireLease = (id: string) =>
  t.pool.query(`UPDATE executions SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
const makeAvailable = (id: string) => t.pool.query(`UPDATE executions SET available_at = now() WHERE id = $1`, [id]);

describe('leases, retries, dead letters, fencing', () => {
  it('expired lease requeues with backoff, then dead-letters, admin requeue works, stale results are fenced', async () => {
    const c = await newTenant(t);
    const admin = await newTenant(t, { admin: true });
    const id = (await c.post('/v1/executions', pyJob())).body.id as string;
    await t.pool.query('UPDATE executions SET max_attempts = 2 WHERE id = $1', [id]);

    // Attempt 1: worker dies.
    const first = (await claimFor(t, id))!;
    await t.queue.advance(first.job, first.workerId, 'DISPATCHED', 'STARTING');
    await expireLease(id);
    const pass1 = await runReaperPass(t.ctx);
    expect(pass1.requeued).toBe(1);
    const row1 = (await t.pool.query('SELECT status, attempt, available_at > now() + interval \'3 seconds\' AS backoff FROM executions WHERE id = $1', [id])).rows[0];
    expect(row1).toMatchObject({ status: 'QUEUED', attempt: 1, backoff: true });
    expect(await t.queue.claim('other', 30)).toBeNull(); // still backing off

    // Stale worker heartbeat and completion are rejected.
    expect(await t.queue.heartbeat(first.job, first.workerId, 30)).toEqual({ leaseHeld: false });
    expect(await finish(t, first.job, first.workerId, { stdout: 'stale' })).toBe(false);

    // Attempt 2: also dies → max_attempts reached → DEAD_LETTERED.
    await makeAvailable(id);
    const second = (await claimFor(t, id))!;
    expect(second.job.attempt).toBe(2);
    await expireLease(id);
    const pass2 = await runReaperPass(t.ctx);
    expect(pass2.deadLettered).toBe(1);
    expect((await c.get(`/v1/executions/${id}`)).body).toMatchObject({
      status: 'DEAD_LETTERED',
      failureReason: 'max_attempts_exceeded',
    });

    const dlq = await admin.get('/v1/admin/dlq');
    expect(dlq.body.items.map((e: { id: string }) => e.id)).toContain(id);
    expect((await c.get('/v1/admin/dlq')).status).toBe(403);

    const requeued = await admin.post(`/v1/admin/dlq/${id}/requeue`);
    expect(requeued.status).toBe(200);
    expect(requeued.body).toMatchObject({ status: 'QUEUED', maxAttempts: 5 });

    // Attempt 3 completes; it is the authoritative result.
    const third = (await claimFor(t, id))!;
    expect(third.job.attempt).toBe(3);
    expect(await finish(t, third.job, third.workerId, { stdout: 'final' })).toBe(true);
    const logs = await c.get(`/v1/executions/${id}/logs?inline=true`);
    expect(logs.text).toBe('final');
    // Late duplicate from attempt 2 cannot overwrite it.
    expect(await finish(t, second.job, second.workerId, { stdout: 'late' })).toBe(false);
    expect((await c.get(`/v1/executions/${id}/result`)).body.attempt).toBe(3);

    const counter = await t.pool.query('SELECT running FROM tenant_concurrency WHERE tenant_id = $1', [c.me.tenant.id]);
    expect(counter.rows[0].running).toBe(0);
  });

  it('reconciles stuck CREATED rows', async () => {
    const c = await newTenant(t);
    const tenantId = c.me.tenant.id;
    const withSource = randomUUID();
    const withoutSource = randomUUID();
    for (const id of [withSource, withoutSource]) {
      await t.pool.query(
        `INSERT INTO executions (id, tenant_id, request_hash, language, entry_file, status, limits, artifact_prefix, created_at)
         VALUES ($1, $2, 'h', 'python', 'main.py', 'CREATED', '{"timeoutMs":5000,"memoryMb":256,"cpuMsPerSec":1000,"pids":64}', $3, now() - interval '2 minutes')`,
        [id, tenantId, s3Keys.sourcePrefix(tenantId, id)],
      );
    }
    await t.storage.put(s3Keys.manifest(tenantId, withSource), JSON.stringify({ files: [], stdin: { bytes: 0, sha256: '' } }));
    const pass = await runReaperPass(t.ctx);
    expect(pass.createdRecovered).toBeGreaterThanOrEqual(1);
    expect((await c.get(`/v1/executions/${withSource}`)).body.status).toBe('QUEUED');
    expect((await c.get(`/v1/executions/${withoutSource}`)).body).toMatchObject({
      status: 'FAILED',
      failureReason: 'artifact_missing',
    });
  });

  it('heals drifted concurrency counters', async () => {
    const c = await newTenant(t);
    await t.pool.query('UPDATE tenant_concurrency SET running = 7 WHERE tenant_id = $1', [c.me.tenant.id]);
    await runReaperPass(t.ctx);
    const r = await t.pool.query('SELECT running FROM tenant_concurrency WHERE tenant_id = $1', [c.me.tenant.id]);
    expect(r.rows[0].running).toBe(0);
  });
});

describe('admin', () => {
  it('lists workers, queue, tenants and patches limits', async () => {
    const admin = await newTenant(t, { admin: true });
    const c = await newTenant(t);
    await t.queue.register({ id: `w-${randomUUID().slice(0, 6)}`, hostname: 'h', version: 'test', slots: 2, status: 'active' });
    const workers = await admin.get('/v1/admin/workers');
    expect(workers.status).toBe(200);
    expect(workers.body.items[0]).toMatchObject({ alive: true });
    await c.post('/v1/executions', pyJob());
    const queue = await admin.get('/v1/admin/queue');
    expect(queue.body.depth).toBeGreaterThanOrEqual(1);
    const tenants = await admin.get('/v1/admin/tenants');
    expect(tenants.body.items.some((x: { id: string }) => x.id === c.me.tenant.id)).toBe(true);
    const patched = await admin.patch(`/v1/admin/tenants/${c.me.tenant.id}/limits`, { maxConcurrent: 2 });
    expect(patched.body.maxConcurrent).toBe(2);
    expect((await admin.patch(`/v1/admin/tenants/${c.me.tenant.id}/limits`, { maxTimeoutMs: 99_999 })).status).toBe(400);
    expect((await c.get('/v1/admin/tenants')).status).toBe(403);
  });
});

describe('auth', () => {
  it('register, login, me, logout', async () => {
    const email = `u-${randomUUID()}@example.com`;
    const reg = await request(t.app.server).post('/v1/auth/register').send({ tenantName: 'Acme', email, password: 'long-enough-pw' });
    expect(reg.status).toBe(201);
    expect(String(reg.headers['set-cookie'])).toMatch(/HttpOnly/i);
    expect(String(reg.headers['set-cookie'])).toMatch(/SameSite=Lax/i);
    const dup = await request(t.app.server).post('/v1/auth/register').send({ tenantName: 'Acme', email, password: 'long-enough-pw' });
    expect(dup.status).toBe(409);
    const bad = await request(t.app.server).post('/v1/auth/login').send({ email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    const ok = await request(t.app.server).post('/v1/auth/login').send({ email, password: 'long-enough-pw' });
    expect(ok.body.user.email).toBe(email);
    const cookie = (ok.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    expect((await request(t.app.server).get('/v1/me').set('Cookie', cookie)).body.tenant.name).toBe('Acme');
    expect((await request(t.app.server).get('/v1/me')).status).toBe(401);
    const out = await request(t.app.server).post('/v1/auth/logout').set('Cookie', cookie).set('x-csrf-token', ok.body.csrfToken);
    expect(out.status).toBe(204);
  });
});
