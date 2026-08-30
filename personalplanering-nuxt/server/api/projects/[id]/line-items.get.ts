import { pool } from '../../../utils/db'
import { requireOrg } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = getRouterParam(event, 'id')
  const { rows } = await pool.query(
    'SELECT * FROM project_line_items WHERE project_id = $1 AND org_id = $2 ORDER BY date NULLS LAST, id',
    [id, orgId]
  )
  return rows
})
