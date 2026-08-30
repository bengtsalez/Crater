import { pool } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const { rows } = await pool.query(
    `UPDATE organizations
     SET onboarded_at = COALESCE(onboarded_at, now())
     WHERE id = $1
     RETURNING id, name, app_title, onboarded_at, onboarding_state`,
    [user.org]
  )
  return rows[0]
})
