import { pool } from '../utils/db'
import { requireOrg } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const { rows } = await pool.query(
    'SELECT * FROM resources WHERE org_id = $1 ORDER BY type, category, name',
    [orgId]
  )
  return rows
})
