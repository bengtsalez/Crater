import { pool } from '../../../utils/db'
import { requireOrg } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = getRouterParam(event, 'id')
  const { rows } = await pool.query(
    `SELECT t.*, u.username
     FROM tasks t
     JOIN users u ON u.id = t.user_id
     WHERE t.project_id = $1 AND t.org_id = $2
     ORDER BY t.created_at DESC`,
    [id, orgId]
  )
  return rows
})
