import pg from 'pg';
export function database() {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL no .env.');
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : undefined,
    max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
    statement_timeout: 15000
  });
}
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
