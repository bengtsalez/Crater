import { pool } from '../../../utils/db'
import { requireOrg } from '../../../utils/auth'
import { ACTIVITY_SELECT } from '../../../utils/queries'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = getRouterParam(event, 'id')
  const limitRaw = Number(getQuery(event).limit)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50
  const { rows } = await pool.query(
    `${ACTIVITY_SELECT} WHERE ae.org_id = $1 AND ae.project_id = $2 ORDER BY ae.created_at DESC LIMIT $3`,
    [orgId, id, limit]
  )
  return rows
})
