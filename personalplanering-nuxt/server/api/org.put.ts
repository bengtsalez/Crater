import { pool } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import { apiError } from '../utils/http'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const b = await readBody(event)

  const name = b?.name !== undefined ? String(b.name).trim() : undefined
  const appTitle = b?.app_title !== undefined ? String(b.app_title).trim() : undefined

  if (name !== undefined && (name.length < 2 || name.length > 80)) {
    throw apiError(400, 'Ogiltigt företagsnamn.')
  }

  const { rows } = await pool.query(
    `UPDATE organizations
     SET name = COALESCE($2, name),
         app_title = COALESCE($3, app_title)
     WHERE id = $1
     RETURNING id, name, app_title, onboarded_at, onboarding_state`,
    [user.org, name ?? null, appTitle ?? null]
  )
  return rows[0]
})
