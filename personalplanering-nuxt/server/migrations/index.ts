import m0001 from './0001_multitenancy'
import m0002 from './0002_project_status_override'
import m0003 from './0003_small_jobs'
import m0004 from './0004_customers'
import m0005 from './0005_renumber_small_jobs'

// Ordnad lista. Lägg nya migreringar sist – aldrig ändra `version` på en befintlig.
export interface Migration {
  version: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  { version: '0001_multitenancy', sql: m0001 },
  { version: '0002_project_status_override', sql: m0002 },
  { version: '0003_small_jobs', sql: m0003 },
  { version: '0004_customers', sql: m0004 },
  { version: '0005_renumber_small_jobs', sql: m0005 },
]
