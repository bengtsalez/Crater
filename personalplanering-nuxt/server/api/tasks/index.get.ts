import { pool } from '../../utils/db'
import { TASK_SELECT } from '../../utils/queries'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const { rows } = await pool.query(
    `${TASK_SELECT} WHERE t.user_id = $1 AND t.org_id = $2 ORDER BY t.created_at DESC`,
    [user.sub, user.org]
  )
  return rows
})
