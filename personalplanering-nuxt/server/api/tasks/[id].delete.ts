import { pool } from '../../utils/db'
import { requireInternal } from '../../utils/auth'
import { apiError } from '../../utils/http'
import { logActivity } from '../../utils/activity'
import { canManageTask } from '../../utils/taskAccess'

export default defineEventHandler(async (event) => {
  const user = requireInternal(event)
  const id = getRouterParam(event, 'id')

  const existingResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [id])
  const existing = existingResult.rows[0]
  if (!existing || !(await canManageTask(pool, user, existing))) {
    throw apiError(404, 'Hittades inte.')
  }
  await pool.query('DELETE FROM tasks WHERE id = $1 AND org_id = $2', [id, user.org])

  await logActivity(
    pool,
    {
      orgId: user.org,
      userId: user.sub,
      entityType: 'task',
      entityId: Number(id),
      projectId: existing.project_id,
      eventType: 'task.deleted',
      metadata: { title: existing.title },
    },
    { bestEffort: true }
  )

  setResponseStatus(event, 204)
  return null
})
