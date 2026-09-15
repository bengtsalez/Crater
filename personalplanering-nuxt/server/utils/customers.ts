import type { Pool } from 'pg'
import { apiError } from './http'

type Queryable = { query: Pool['query'] }

// Måste matcha den genererade kolumnen customers.name_key exakt.
export function normalizeCustomerName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export interface ResolvedCustomer {
  id: number | null
  name: string | null
}

// Validera att en kund finns i den aktuella orgen. Returnerar kundens namn.
export async function assertCustomerId(client: Queryable, orgId: number, customerId: number | string): Promise<string> {
  const { rows } = await client.query('SELECT name FROM customers WHERE id = $1 AND org_id = $2', [customerId, orgId])
  if (!rows[0]) {
    throw apiError(400, 'Ogiltig kund.')
  }
  return rows[0].name
}

// Hitta-eller-skapa på normaliserat namn. SELECT-fastpath för det vanliga
// fallet (kunden finns redan), annars en upsert som fungerar som lookup:
// ON CONFLICT ... DO UPDATE (inte DO NOTHING) garanterar att vi alltid får
// tillbaka en rad även om en samtidig request precis skapade samma kund,
// och `SET name = customers.name` (aldrig EXCLUDED.name) skyddar den
// kanoniska stavningen mot att skrivas över av en efterföljande variant.
export async function findOrCreateCustomer(client: Queryable, orgId: number, rawName: string): Promise<ResolvedCustomer> {
  const name = rawName.trim()
  const nameKey = normalizeCustomerName(name)
  const existing = await client.query('SELECT id, name FROM customers WHERE org_id = $1 AND name_key = $2', [orgId, nameKey])
  if (existing.rows[0]) {
    return { id: existing.rows[0].id, name: existing.rows[0].name }
  }
  const { rows } = await client.query(
    `INSERT INTO customers (org_id, name) VALUES ($1, $2)
     ON CONFLICT (org_id, name_key) DO UPDATE SET name = customers.name
     RETURNING id, name`,
    [orgId, name]
  )
  return { id: rows[0].id, name: rows[0].name }
}

interface ResolveCustomerInput {
  customer_id?: number | string | null
  customer_name?: string | null
  client?: string | null
}

// Hela prioritetsordningen: explicit vald kund > exakt namnmatch > skapa ny.
// `client` accepteras som en legacy-alias för customer_name så att äldre
// anropare (t.ex. onboarding-guidens projektformulär) fortsätter fungera
// oförändrade och ändå kopplas mot en riktig kund.
export async function resolveCustomer(client: Queryable, orgId: number, input: ResolveCustomerInput): Promise<ResolvedCustomer> {
  if (input.customer_id) {
    const name = await assertCustomerId(client, orgId, input.customer_id)
    return { id: Number(input.customer_id), name }
  }
  const raw = input.customer_name ?? input.client
  if (raw && raw.trim()) {
    return findOrCreateCustomer(client, orgId, raw)
  }
  return { id: null, name: null }
}
