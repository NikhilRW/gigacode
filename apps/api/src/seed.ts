// Seed: platform admin, a demo tenant with an owner, and a demo API key. Idempotent by email.
// Run: docker compose exec api pnpm --filter @engine/api seed
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { ApiKeyRepo, AuthRepo, createPool, withTx } from '@engine/db';
import { generateApiKey } from './auth/apikeys.ts';

const ARGON = { algorithm: 2 as const, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const env = process.env;
const pool = createPool(env.DATABASE_URL ?? 'postgres://app:app@localhost:5432/engine');
const auth = new AuthRepo(pool);

async function ensureAccount(tenantName: string, email: string, password: string, role: 'owner' | 'platform_admin') {
  const existing = await auth.findUserByEmail(email);
  if (existing) return { tenantId: existing.tenant_id, created: false };
  const tenantId = randomUUID();
  await withTx(pool, async (client) => {
    await new AuthRepo(client).createTenantWithOwner({
      tenantId,
      tenantName,
      userId: randomUUID(),
      email,
      passwordHash: await hash(password, ARGON),
      role,
    });
  });
  return { tenantId, created: true };
}

const adminEmail = env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
const adminPassword = env.SEED_ADMIN_PASSWORD ?? 'admin-password-123';
const demoEmail = env.SEED_DEMO_EMAIL ?? 'demo@example.com';
const demoPassword = env.SEED_DEMO_PASSWORD ?? 'demo-password-123';

await ensureAccount('Platform', adminEmail, adminPassword, 'platform_admin');
const demo = await ensureAccount('Demo Tenant', demoEmail, demoPassword, 'owner');

console.log(`admin:  ${adminEmail} / ${adminPassword}`);
console.log(`demo:   ${demoEmail} / ${demoPassword}`);
if (demo.created) {
  const key = generateApiKey();
  await new ApiKeyRepo(pool, demo.tenantId).create({ id: randomUUID(), name: 'demo', prefix: key.prefix, keyHash: key.hash });
  console.log(`demo API key (shown once): ${key.key}`);
} else {
  console.log('demo tenant already existed; create a new API key from the dashboard if needed');
}
await pool.end();
