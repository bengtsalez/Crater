import { pool } from './db'
import { MIGRATIONS } from '../migrations'

// Framåtriktad migrationsrunner. Körs från `ready` i db.ts efter den idempotenta
// bootstrap-strängen. Varje post i MIGRATIONS körs en gång, i ordning, i en
// transaktion, och registreras i `schema_migrations`.
//
// En session-övergripande advisory-lock serialiserar mot samtidiga instanser
// (t.ex. flera serverless-funktioner som startar samtidigt). Förlorarna hittar
// migrationen redan registrerad och hoppar över den.

const LOCK_KEY = 72701

let started: Promise<void> | null = null

export function runMigrations(): Promise<void> {
  if (!started) started = execute()
  return started
}

async function execute(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    const { rows } = await client.query('SELECT version FROM schema_migrations')
    const done = new Set<string>(rows.map((r) => r.version))

    for (const migration of MIGRATIONS) {
      if (done.has(migration.version)) continue

      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version])
        await client.query('COMMIT')
        console.log(`[migrate] applied ${migration.version}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {})
    client.release()
  }
}
