import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { drainQueue, newTenant, pyJob, setup, type TestEnv } from './helpers.ts';

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

describe('profile', () => {
  it('register accepts an optional name and returns it; legacy accounts have null', async () => {
    const email = `named-${randomUUID()}@example.com`;
    const reg = await request(t.app.server)
      .post('/v1/auth/register')
      .send({ name: '  Nikhil  ', tenantName: 'Named Co', email, password: 'correct-horse-battery' });
    expect(reg.status).toBe(201);
    expect(reg.body.user.name).toBe('Nikhil');

    const plain = await newTenant(t);
    expect(plain.me.user.name).toBeNull();
  });

  it('PATCH /v1/me updates the name and validates it', async () => {
    const c = await newTenant(t);
    const ok = await c.patch('/v1/me', { name: 'Ada Lovelace' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.name).toBe('Ada Lovelace');
    expect((await c.get('/v1/me')).body.user.name).toBe('Ada Lovelace');
    expect((await c.patch('/v1/me', { name: '   ' })).status).toBe(400);
    expect((await c.patch('/v1/me', { name: 'x', extra: 1 })).status).toBe(400);
  });

  it('PATCH /v1/me requires CSRF and a session (API keys get 403)', async () => {
    const c = await newTenant(t);
    const noCsrf = await request(t.app.server).patch('/v1/me').set('Cookie', c.cookie).send({ name: 'x' });
    expect(noCsrf.status).toBe(403);
    const key = await c.post('/v1/api-keys', { name: 'k' });
    const viaKey = await request(t.app.server)
      .patch('/v1/me')
      .set('Authorization', `Bearer ${key.body.key}`)
      .send({ name: 'x' });
    expect(viaKey.status).toBe(403);
    expect(viaKey.body.error.code).toBe('session_required');
  });

  it('changes the password: wrong current is rejected, new works for login, old does not', async () => {
    const c = await newTenant(t);
    const email = c.me.user.email;
    const wrong = await c.post('/v1/me/password', { currentPassword: 'nope-nope-nope', newPassword: 'a-brand-new-password' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('wrong_password');
    expect((await c.post('/v1/me/password', { currentPassword: 'correct-horse-battery', newPassword: 'short' })).status).toBe(400);

    const ok = await c.post('/v1/me/password', {
      currentPassword: 'correct-horse-battery',
      newPassword: 'a-brand-new-password',
    });
    expect(ok.status).toBe(204);
    const oldLogin = await request(t.app.server).post('/v1/auth/login').send({ email, password: 'correct-horse-battery' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(t.app.server).post('/v1/auth/login').send({ email, password: 'a-brand-new-password' });
    expect(newLogin.status).toBe(200);
  });
});

describe('onboarding checklist', () => {
  it('ticks off as the tenant runs code, creates a key, and uses it', async () => {
    const c = await newTenant(t);
    expect((await c.get('/v1/onboarding')).body).toEqual({ ranExecution: false, createdApiKey: false, usedApiKey: false });

    await c.post('/v1/executions', pyJob('print(1)'));
    expect((await c.get('/v1/onboarding')).body).toEqual({ ranExecution: true, createdApiKey: false, usedApiKey: false });

    const key = await c.post('/v1/api-keys', { name: 'k' });
    expect((await c.get('/v1/onboarding')).body).toEqual({ ranExecution: true, createdApiKey: true, usedApiKey: false });

    const viaKey = await request(t.app.server)
      .post('/v1/executions')
      .set('Authorization', `Bearer ${key.body.key}`)
      .send(pyJob('print(2)'));
    expect(viaKey.status).toBe(202);
    expect((await c.get('/v1/onboarding')).body).toEqual({ ranExecution: true, createdApiKey: true, usedApiKey: true });
  });

  it('is isolated per tenant', async () => {
    const a = await newTenant(t);
    const b = await newTenant(t);
    await a.post('/v1/executions', pyJob('print(1)'));
    expect((await b.get('/v1/onboarding')).body.ranExecution).toBe(false);
  });
});

describe('usage timeseries', () => {
  it('returns one point per hour including empty hours, scoped to the tenant', async () => {
    const a = await newTenant(t);
    const b = await newTenant(t);
    await a.post('/v1/executions', pyJob('print(1)'));
    await a.post('/v1/executions', pyJob('print(2)'));
    await b.post('/v1/executions', pyJob('print(3)'));

    const res = await a.get('/v1/usage/timeseries?hours=6');
    expect(res.status).toBe(200);
    expect(res.body.hours).toBe(6);
    expect(res.body.points).toHaveLength(6);
    const total = res.body.points.reduce(
      (n: number, p: { success: number; failed: number; timeout: number; cancelled: number; other: number }) =>
        n + p.success + p.failed + p.timeout + p.cancelled + p.other,
      0,
    );
    expect(total).toBe(2);
    expect(res.body.points.at(-1).other).toBe(2); // both still queued (no worker in tests)

    expect((await a.get('/v1/usage/timeseries?hours=0')).status).toBe(400);
    expect((await a.get('/v1/usage/timeseries?hours=500')).status).toBe(400);
    expect((await a.get('/v1/usage/timeseries')).body.points).toHaveLength(24);
  });
});

describe('runs search by ID prefix', () => {
  it('finds a run by the start of its ID, only within the tenant', async () => {
    const a = await newTenant(t);
    const b = await newTenant(t);
    const created = await a.post('/v1/executions', pyJob('print(1)'));
    await a.post('/v1/executions', pyJob('print(2)'));
    const id: string = created.body.id;

    const hit = await a.get(`/v1/executions?q=${id.slice(0, 8)}`);
    expect(hit.status).toBe(200);
    expect(hit.body.items.map((e: { id: string }) => e.id)).toContain(id);
    expect(hit.body.items.every((e: { id: string }) => e.id.startsWith(id.slice(0, 8)))).toBe(true);

    expect((await b.get(`/v1/executions?q=${id}`)).body.items).toHaveLength(0);
    expect((await a.get('/v1/executions?q=not-hex!')).status).toBe(400);
    expect((await a.get(`/v1/executions?q=${'a'.repeat(37)}`)).status).toBe(400);
  });
});
