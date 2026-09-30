import { PGlite } from '@electric-sql/pglite'
import { BOOTSTRAP_SQL } from '../server/utils/schema'
import { MIGRATIONS } from '../server/migrations'

// Riktig Postgres (WASM) för integrationstester – ingen prod-DB rörs.
// Bygger exakt samma schema som appen: bootstrap-strängen + alla migreringar.
export interface TestDb {
  pg: PGlite
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>
  close: () => Promise<void>
}

export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite()
  await pg.exec(BOOTSTRAP_SQL)
  for (const m of MIGRATIONS) await pg.exec(m.sql)
  return {
    pg,
    async query(text, params = []) {
      const res = await pg.query(text, params as any[])
      return { rows: res.rows as any[], rowCount: res.affectedRows ?? res.rows.length }
    },
    close: () => pg.close(),
  }
}
