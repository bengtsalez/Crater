import { pool } from '../../utils/db'
import { TASK_SELECT } from '../../utils/queries'
import { requireInternal } from '../../utils/auth'
import { apiError } from '../../utils/http'
import { logActivity } from '../../utils/activity'
import { resolveTaskAssignee } from '../../utils/taskAccess'

export default defineEventHandler(async (event) => {
  const user = requireInternal(event)
  const b = await readBody(event)
  const { title, notes, project_id, status, due_date, user_id } = b || {}
  if (!title || !title.trim()) {
    throw apiError(400, 'Titel krävs.')
  }

  if (project_id) {
    const { rowCount } = await pool.query('SELECT 1 FROM projects WHERE id = $1 AND org_id = $2', [project_id, user.org])
    if (!rowCount) throw apiError(400, 'Ogiltig referens.')
  }
  const assigneeId = await resolveTaskAssignee(pool, user, user_id, project_id)

  const inserted = await pool.query(
    `INSERT INTO tasks (org_id, user_id, project_id, title, notes, status, due_date, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [user.org, assigneeId, project_id || null, title.trim(), notes || null, status || 'aktiv', due_date || null, user.sub]
  )
  const taskId = inserted.rows[0].id

  await logActivity(
    pool,
    {
      orgId: user.org,
      userId: user.sub,
      entityType: 'task',
      entityId: taskId,
      projectId: project_id || null,
      eventType: 'task.created',
      metadata: { title: title.trim(), due_date: due_date || null },
    },
    { bestEffort: true }
  )

  const { rows } = await pool.query(`${TASK_SELECT} WHERE t.id = $1`, [taskId])
  setResponseStatus(event, 201)
  return rows[0]
})
