import { pool } from '../utils/db'
import { requireUser } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const { rows } = await pool.query(
    'SELECT id, name, app_title, onboarded_at, onboarding_state FROM organizations WHERE id = $1',
    [user.org]
  )
  return {
    id: user.sub,
    username: user.username,
    role: user.role,
    org: rows[0] ?? null,
  }
})
