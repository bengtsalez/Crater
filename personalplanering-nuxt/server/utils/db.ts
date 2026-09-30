import { Pool } from 'pg'
import { runMigrations } from './migrate'
import { BOOTSTRAP_SQL } from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL saknas i miljövariabler.')
}

export const pool = new Pool({
  connectionString,
  // DATABASE_SSL=false bara för lokala test-databaser utan TLS (t.ex. e2e mot
  // PGlite, se scripts/e2e-employee.ts). Standard oförändrad.
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
})

const FIRST_PROJECT_NUMBER = 1115
const FIRST_SMALL_JOB_NUMBER = 1001

// Schema-bootstrap (server/utils/schema.ts) följt av ordnade migreringar.
function bootstrapSchema(): Promise<unknown> {
  return pool.query(BOOTSTRAP_SQL).then(() => runMigrations())
}

// Memoiserad schema-bootstrap. Vid ett övergående fel (t.ex. tappad anslutning
// mot serverless-Postgres när funktionsinstansen just startat) NOLLSTÄLLS
// promisen så att nästa request försöker igen – annars fastnar hela
// funktionsinstansen i "Server Error" på varje anrop tills den återvinns, och
// användaren tvingas vänta/rensa och försöka igen för att träffa en ny instans.
let schemaReady: Promise<unknown> | null = null

export function ensureSchema(): Promise<unknown> {
  if (!schemaReady) {
    schemaReady = bootstrapSchema().catch((err) => {
      schemaReady = null
      throw err
    })
  }
  return schemaReady
}

type Queryable = { query: Pool['query'] }

export async function highestProjectNumber(client: Queryable, orgId: number): Promise<number> {
  // `work_type = 'project'` är avgörande: utan det läcker ströjobbens SJ-nummer
  // (t.ex. "SJ26000001" → 26000001 efter siffer-strippningen) in i den vanliga
  // P-nummerserien och skjuter den huvudlöst uppåt.
  const { rows } = await client.query(
    `SELECT MAX(NULLIF(regexp_replace(project_number, '[^0-9]', '', 'g'), '')::integer) AS max_number
     FROM projects WHERE org_id = $1 AND work_type = 'project'`,
    [orgId]
  )
  return rows[0].max_number ? Number(rows[0].max_number) : FIRST_PROJECT_NUMBER - 1
}

export async function nextProjectNumber(orgId: number): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Serialisera mot samtidiga inserts inom samma org – ingen räknarrad att låsa.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('next_project_number'), $1::int)", [orgId])
    const current = (await highestProjectNumber(client, orgId)) + 1
    await client.query('COMMIT')
    return 'P' + current
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Ströjobb har en egen nummerserie: SJ + löpnummer (SJ1001, SJ1002, ...), utan
// årsprefix och utan återställning. Eget lås-nyckel så serien inte
// blockerar/blockeras av den vanliga projektnumreringen.
export async function nextSmallJobNumber(orgId: number): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('next_small_job_number'), $1::int)", [orgId])
    const { rows } = await client.query(
      `SELECT MAX(NULLIF(regexp_replace(substring(project_number from 3), '[^0-9]', '', 'g'), '')::integer) AS max_number
       FROM projects WHERE org_id = $1 AND work_type = 'small_job' AND project_number LIKE 'SJ%'`,
      [orgId]
    )
    const next = (rows[0].max_number ? Number(rows[0].max_number) : FIRST_SMALL_JOB_NUMBER - 1) + 1
    await client.query('COMMIT')
    return 'SJ' + next
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
