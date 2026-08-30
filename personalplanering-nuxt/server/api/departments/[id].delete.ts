import { pool } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { apiError } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const id = getRouterParam(event, 'id')

  const existing = await pool.query(
    'SELECT key FROM departments WHERE id = $1 AND org_id = $2',
    [id, user.org]
  )
  const dept = existing.rows[0]
  if (!dept) throw apiError(404, 'Hittades inte.')

  const inUse = await pool.query(
    `SELECT
       (SELECT count(*) FROM resources WHERE org_id = $1 AND category = $2) +
       (SELECT count(*) FROM projects  WHERE org_id = $1 AND category = $2) AS n`,
    [user.org, dept.key]
  )
  if (Number(inUse.rows[0].n) > 0) {
    throw apiError(409, 'Avdelningen används av personal eller projekt och kan inte tas bort.')
  }

  await pool.query('DELETE FROM departments WHERE id = $1 AND org_id = $2', [id, user.org])
  setResponseStatus(event, 204)
  return null
})
