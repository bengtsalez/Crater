import type { H3Event } from 'h3'
import { pool } from './db'
import { requireBilling } from './auth'
import { apiError } from './http'
import { BillingError } from './billingCrypto'
import { getProjectBilling, type BillingCtx, type BillingDb } from './billing'

// Route-lager för Fakturering: behörighet (admin/member), transaktioner mot
// poolen och översättning av BillingError → svenskt API-fel.

export function billingDb(): BillingDb {
  return {
    query: (text, params) => pool.query(text, params as unknown[]),
    async tx(fn) {
      const conn = await pool.connect()
      try {
        await conn.query('BEGIN')
        const result = await fn({ query: (text, params) => conn.query(text, params as unknown[]) })
        await conn.query('COMMIT')
        return result
      } catch (err) {
        await conn.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        conn.release()
      }
    },
  }
}

export async function billingRoute<T>(
  event: H3Event,
  fn: (args: { db: BillingDb; ctx: BillingCtx }) => Promise<T>
): Promise<T> {
  const user = requireBilling(event)
  try {
    return await fn({ db: billingDb(), ctx: { orgId: user.org, userId: user.sub } })
  } catch (err) {
    if (err instanceof BillingError) throw apiError(err.status, err.message)
    if ((err as { code?: string }).code === '23505') throw apiError(409, 'Uppgiften har redan registrerats (konflikt).')
    throw err
  }
}

export function routeId(event: H3Event, name = 'id'): number {
  const id = Number(getRouterParam(event, name))
  if (!Number.isInteger(id) || id <= 0) throw apiError(404, 'Hittades inte.')
  return id
}

export async function billingView(db: BillingDb, orgId: number, projectId: number) {
  const view = await getProjectBilling(db, orgId, projectId)
  if (!view) throw apiError(404, 'Hittades inte.')
  return view
}

export async function projectOfPart(db: BillingDb, orgId: number, partId: number): Promise<number> {
  const { rows } = await db.query('SELECT project_id FROM billing_parts WHERE id = $1 AND org_id = $2', [partId, orgId])
  if (!rows[0]) throw apiError(404, 'Hittades inte.')
  return Number(rows[0].project_id)
}
