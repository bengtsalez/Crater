import { pool } from '../../utils/db'
import { TASK_SELECT } from '../../utils/queries'
import { requireInternal } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireInternal(event)
  const { rows } = await pool.query(
    `${TASK_SELECT} WHERE t.user_id = $1 AND t.org_id = $2 ORDER BY t.created_at DESC`,
    [user.sub, user.org]
  )
  return rows
})
