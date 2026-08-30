import { pool } from '../../utils/db'
import { requireOrg } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = getRouterParam(event, 'id')
  await pool.query('DELETE FROM assignments WHERE id = $1 AND org_id = $2', [id, orgId])
  setResponseStatus(event, 204)
  return null
})
