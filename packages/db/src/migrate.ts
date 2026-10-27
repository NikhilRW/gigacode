import { runner } from 'node-pg-migrate';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export async function migrateUp(databaseUrl: string): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    log: () => {},
  });
}

/**
 * Create or update the worker login role. Roles are cluster-wide and need a password
 * from the environment, so this is not a migration.
 */
export async function ensureWorkerLogin(databaseUrl: string, login: string, password: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(login)) throw new Error('invalid worker login name');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [login]);
    const quoted = client.escapeLiteral(password);
    if (exists.rowCount === 0) await client.query(`CREATE ROLE ${login} LOGIN PASSWORD ${quoted} IN ROLE worker_role`);
    else await client.query(`ALTER ROLE ${login} WITH LOGIN PASSWORD ${quoted}`);
    await client.query(`GRANT worker_role TO ${login}`);
  } finally {
    await client.end();
  }
}
