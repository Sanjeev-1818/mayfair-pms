// Database adapter: Replit PostgreSQL (DATABASE_URL) in production, embedded PGlite for local development.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, DATA_DIR } from './config.js';

const DATE_OID = 1082;
const NUMERIC_OID = 1700;
let impl;

export async function initDb() {
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    pg.types.setTypeParser(DATE_OID, (v) => v);
    pg.types.setTypeParser(NUMERIC_OID, (v) => Number(v));
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    impl = {
      query: async (sql, params) => (await pool.query(sql, params)).rows,
      exec: (sql) => pool.query(sql),
      tx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: async (sql, params) => (await client.query(sql, params)).rows });
          await client.query('COMMIT');
          return result;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
    };
    console.log('Database: PostgreSQL');
  } else {
    const { PGlite, types } = await import('@electric-sql/pglite');
    const dir = path.join(DATA_DIR, 'pglite');
    const parsers = { [DATE_OID]: (v) => v, [NUMERIC_OID]: (v) => Number(v) };
    const lite = await PGlite.create(dir, { parsers });
    impl = {
      query: async (sql, params) => (await lite.query(sql, params)).rows,
      exec: (sql) => lite.exec(sql),
      tx: (fn) => lite.transaction((t) => fn({ query: async (sql, params) => (await t.query(sql, params)).rows })),
    };
    console.log(`Database: local PGlite (${dir})`);
  }
  await migrate();
}

async function migrate() {
  await impl.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  const done = new Set((await impl.query('SELECT version FROM schema_migrations')).map((r) => r.version));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await impl.tx(async (t) => {
      for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await t.query(stmt);
      await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    });
    console.log(`Migration applied: ${file}`);
  }
}

export const db = {
  query: (sql, params = []) => impl.query(sql, params),
  one: async (sql, params = []) => (await impl.query(sql, params))[0] || null,
  tx: (fn) => impl.tx(fn),
};
