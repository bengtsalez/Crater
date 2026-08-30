import { pool } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { apiError } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const id = getRouterParam(event, 'id')

  const existingResult = await pool.query('SELECT user_id, org_id FROM tasks WHERE id = $1', [id])
  const existing = existingResult.rows[0]
  if (!existing || existing.user_id !== user.sub || existing.org_id !== user.org) {
    throw apiError(404, 'Hittades inte.')
  }
  await pool.query('DELETE FROM tasks WHERE id = $1', [id])
  setResponseStatus(event, 204)
  return null
})
