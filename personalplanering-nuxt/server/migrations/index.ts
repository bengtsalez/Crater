import m0001 from './0001_multitenancy'

// Ordnad lista. Lägg nya migreringar sist – aldrig ändra `version` på en befintlig.
export interface Migration {
  version: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  { version: '0001_multitenancy', sql: m0001 },
]
