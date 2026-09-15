import type { Project } from '~/types'

// Måste matcha server/utils/customers.ts normalizeCustomerName exakt.
export function normalizeCustomerName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

// Visningsnamn med legacy-fallback under övergången till customer_id.
export function projectCustomerName(p: Project): string {
  return p.customer_name || p.client || ''
}
