import bcrypt from 'bcryptjs'
import { pool } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { apiError } from '../../utils/http'
import { assertLinkableResource, isResourceUniqueViolation, normalizePhone, parseUserRole } from '../../utils/users'

// Admin: ändra roll, aktiv-status, resurskoppling, telefon eller lösenord.
// Ändringarna gäller från nästa anrop eftersom auth-middlewaren läser
// användaren från DB varje gång (en äldre JWT ger alltså ingen extra åtkomst).
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw apiError(404, 'Hittades inte.')

  const { rows: existingRows } = await pool.query(
    'SELECT id, role, active, resource_id, phone FROM users WHERE id = $1 AND org_id = $2',
    [id, admin.org]
  )
  const existing = existingRows[0]
  if (!existing) throw apiError(404, 'Hittades inte.')

  const b = (await readBody(event)) || {}
  const role = b.role !== undefined ? parseUserRole(b.role, existing.role) : existing.role
  const active = b.active !== undefined ? Boolean(b.active) : existing.active
  const phone = b.phone !== undefined ? normalizePhone(b.phone) : existing.phone

  const isSelf = id === admin.sub
  if (isSelf && (role !== 'admin' || !active)) {
    throw apiError(400, 'Du kan inte ta bort din egen adminbehörighet eller avaktivera dig själv.')
  }
  if (existing.role === 'admin' && existing.active && (role !== 'admin' || !active)) {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND role = 'admin' AND active AND id <> $2",
      [admin.org, id]
    )
    if (!rows[0].n) throw apiError(400, 'Organisationen måste ha minst en aktiv admin.')
  }

  // Resurskopplingen gäller bara personalkonton.
  let resourceId: number | null = null
  if (role === 'employee') {
    if (b.resource_id !== undefined) {
      resourceId = b.resource_id === null || b.resource_id === '' ? null : await assertLinkableResource(pool, admin.org, b.resource_id, id)
    } else {
      resourceId = existing.resource_id
    }
  }

  let passwordHash: string | null = null
  if (b.password !== undefined && b.password !== '') {
    const password = String(b.password)
    if (password.length < 8) throw apiError(400, 'Lösenordet måste vara minst 8 tecken.')
    passwordHash = await bcrypt.hash(password, 10)
  }

  try {
    const { rows } = await pool.query(
      `UPDATE users
       SET role = $1, active = $2, resource_id = $3, phone = $4,
           password_hash = COALESCE($5, password_hash)
       WHERE id = $6 AND org_id = $7
       RETURNING id, username, email, role, active, phone, resource_id`,
      [role, active, resourceId, phone, passwordHash, id, admin.org]
    )
    return rows[0]
  } catch (err) {
    if (isResourceUniqueViolation(err)) throw apiError(409, 'Personen har redan ett konto.')
    throw err
  }
})
