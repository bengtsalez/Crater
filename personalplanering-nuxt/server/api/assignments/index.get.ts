import { pool } from '../../utils/db'
import { requireOrg } from '../../utils/auth'
import { ASSIGNMENT_SELECT } from '../../utils/queries'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const { rows } = await pool.query(
    `${ASSIGNMENT_SELECT} WHERE a.org_id = $1 ORDER BY a.start_date`,
    [orgId]
  )
  return rows
})
