import { pool } from '../../utils/db'
import { requireOrg } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.email, u.role, u.active, u.phone, u.resource_id, r.name AS resource_name
     FROM users u
     LEFT JOIN resources r ON r.id = u.resource_id AND r.org_id = u.org_id
     WHERE u.org_id = $1
     ORDER BY u.username`,
    [orgId]
  )
  return rows
})
