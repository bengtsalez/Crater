import { pool } from '../../utils/db'
import { requireOrg } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const { rows } = await pool.query(
    'SELECT id, org_id, key, label, sort_order FROM departments WHERE org_id = $1 ORDER BY sort_order, id',
    [orgId]
  )
  return rows
})
