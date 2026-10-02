import type { Pool } from 'pg'
import { apiError } from './http'

type Queryable = { query: Pool['query'] }

export const USER_ROLES = ['admin', 'member', 'employee', 'accountant'] as const
export type AssignableRole = (typeof USER_ROLES)[number]

export function parseUserRole(v: unknown, fallback: AssignableRole): AssignableRole {
  return (USER_ROLES as readonly unknown[]).includes(v) ? (v as AssignableRole) : fallback
}

// Personalresurs för ett personalkonto: måste finnas i samma org och inte
// redan vara kopplad till ett annat konto (unikt index users_resource_uniq
// fångar kapplöpningar; det här ger ett begripligt fel i normalfallet).
export async function assertLinkableResource(
  db: Queryable,
  orgId: number,
  resourceId: unknown,
  exceptUserId: number | null
): Promise<number> {
  const id = Number(resourceId)
  if (!Number.isInteger(id) || id <= 0) throw apiError(400, 'Välj vilken personalresurs kontot gäller.')
  const { rows } = await db.query('SELECT id FROM resources WHERE id = $1 AND org_id = $2', [id, orgId])
  if (!rows[0]) throw apiError(400, 'Ogiltig personalresurs.')
  const taken = await db.query(
    'SELECT 1 FROM users WHERE resource_id = $1 AND ($2::int IS NULL OR id <> $2::int) LIMIT 1',
    [id, exceptUserId]
  )
  if (taken.rowCount) throw apiError(409, 'Personen har redan ett konto.')
  return id
}

export function normalizePhone(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, 40) : null
}

// Unikt index på resource_id → 409 i stället för 500 vid kapplöpning.
export function isResourceUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string }
  return e?.code === '23505' && e?.constraint === 'users_resource_uniq'
}
