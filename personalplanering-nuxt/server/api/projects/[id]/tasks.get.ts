import { pool } from '../../../utils/db'
import { requireOrg } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = getRouterParam(event, 'id')
  // user_role talar om för UI:t vilka uppgifter projektledaren får hantera
  // (egna + personalkontons).
  const { rows } = await pool.query(
    `SELECT t.*, u.username, u.role AS user_role
     FROM tasks t
     JOIN users u ON u.id = t.user_id AND u.org_id = t.org_id
     WHERE t.project_id = $1 AND t.org_id = $2
     ORDER BY t.created_at DESC`,
    [id, orgId]
  )
  return rows
})
