import type { ApiKey, Role } from '@engine/shared';
import type { Queryable } from '../pool.ts';
import { toApiKey, type TenantRow } from '../rows.ts';
import { isUuid } from './executions.ts';

export interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: Role;
}

export interface ApiKeyLookup {
  id: string;
  tenantId: string;
  keyHash: string;
  revoked: boolean;
}

/** Lookups used by authentication. These resolve the tenant, so they are not tenant-scoped by design. */
export class AuthRepo {
  constructor(private readonly db: Queryable) {}

  async createTenantWithOwner(args: {
    tenantId: string;
    tenantName: string;
    userId: string;
    email: string;
    passwordHash: string;
    role?: Role;
  }): Promise<void> {
    await this.db.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [args.tenantId, args.tenantName]);
    await this.db.query('INSERT INTO tenant_concurrency (tenant_id) VALUES ($1)', [args.tenantId]);
    await this.db.query(
      'INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
      [args.userId, args.tenantId, args.email.toLowerCase(), args.passwordHash, args.role ?? 'owner'],
    );
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const res = await this.db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    return res.rows[0] ?? null;
  }

  async findUserById(id: string): Promise<UserRow | null> {
    if (!isUuid(id)) return null;
    const res = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0] ?? null;
  }

  async findTenant(id: string): Promise<TenantRow | null> {
    if (!isUuid(id)) return null;
    const res = await this.db.query<TenantRow>('SELECT * FROM tenants WHERE id = $1', [id]);
    return res.rows[0] ?? null;
  }

  async findApiKeyByPrefix(prefix: string): Promise<ApiKeyLookup | null> {
    const res = await this.db.query<{ id: string; tenant_id: string; key_hash: string; revoked_at: Date | null }>(
      'SELECT id, tenant_id, key_hash, revoked_at FROM api_keys WHERE prefix = $1',
      [prefix],
    );
    const r = res.rows[0];
    return r ? { id: r.id, tenantId: r.tenant_id, keyHash: r.key_hash, revoked: r.revoked_at !== null } : null;
  }

  async touchApiKey(id: string): Promise<void> {
    await this.db.query(
      `UPDATE api_keys SET last_used_at = now()
       WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
      [id],
    );
  }
}

/** Tenant-scoped API key management. */
export class ApiKeyRepo {
  constructor(
    private readonly db: Queryable,
    readonly tenantId: string,
  ) {}

  async create(args: { id: string; name: string; prefix: string; keyHash: string }): Promise<ApiKey> {
    const res = await this.db.query(
      `INSERT INTO api_keys (id, tenant_id, name, prefix, key_hash) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [args.id, this.tenantId, args.name, args.prefix, args.keyHash],
    );
    return toApiKey(res.rows[0]);
  }

  async list(): Promise<ApiKey[]> {
    const res = await this.db.query('SELECT * FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC', [
      this.tenantId,
    ]);
    return res.rows.map(toApiKey);
  }

  /** Returns the revoked key's prefix (for cache invalidation), or null if not found for this tenant. */
  async revoke(id: string): Promise<string | null> {
    if (!isUuid(id)) return null;
    const res = await this.db.query<{ prefix: string }>(
      `UPDATE api_keys SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1 AND tenant_id = $2 RETURNING prefix`,
      [id, this.tenantId],
    );
    return res.rows[0]?.prefix ?? null;
  }
}
