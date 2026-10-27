import pg from 'pg';

// int8 (bigint) and numeric as JS numbers: our values (cpu ms, bytes, counts) fit in 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
/** Anything that can run a query: a pool or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(connectionString: string, max = 10, onError?: (err: Error) => void): pg.Pool {
  const pool = new pg.Pool({ connectionString, max, connectionTimeoutMillis: 3000, statement_timeout: 15_000 });
  pool.on('error', (err) => onError?.(err));
  return pool;
}

export async function withTx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
