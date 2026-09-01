import m0001 from './0001_multitenancy'
import m0002 from './0002_project_status_override'

// Ordnad lista. Lägg nya migreringar sist – aldrig ändra `version` på en befintlig.
export interface Migration {
  version: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  { version: '0001_multitenancy', sql: m0001 },
  { version: '0002_project_status_override', sql: m0002 },
]
