import { pool } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { apiError } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const id = getRouterParam(event, 'id')

  const existing = await pool.query('SELECT 1 FROM customers WHERE id = $1 AND org_id = $2', [id, user.org])
  if (!existing.rowCount) throw apiError(404, 'Hittades inte.')

  const inUse = await pool.query('SELECT count(*) AS n FROM projects WHERE customer_id = $1 AND org_id = $2', [id, user.org])
  if (Number(inUse.rows[0].n) > 0) {
    throw apiError(409, 'Kunden har kopplade projekt och kan inte tas bort.')
  }

  await pool.query('DELETE FROM customers WHERE id = $1 AND org_id = $2', [id, user.org])
  setResponseStatus(event, 204)
  return null
})
