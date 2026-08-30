import { pool } from '../utils/db'
import { requireOrg } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const { rows } = await pool.query(
    'SELECT id, username, email, role FROM users WHERE org_id = $1 ORDER BY username',
    [orgId]
  )
  return rows
})
