import { pool } from '../../../utils/db'
import { requireOrg } from '../../../utils/auth'
import { CUSTOMER_SELECT } from '../../../utils/queries'
import { apiError } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = getRouterParam(event, 'id')
  const { rows } = await pool.query(`${CUSTOMER_SELECT} WHERE c.id = $1 AND c.org_id = $2`, [id, orgId])
  if (!rows[0]) throw apiError(404, 'Hittades inte.')
  return rows[0]
})
