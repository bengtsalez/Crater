import { pool } from '../../utils/db'
import { requireOrg } from '../../utils/auth'
import { PROJECT_SELECT } from '../../utils/queries'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const { rows } = await pool.query(
    `${PROJECT_SELECT} WHERE p.org_id = $1 ORDER BY p.project_number`,
    [orgId]
  )
  return rows
})
