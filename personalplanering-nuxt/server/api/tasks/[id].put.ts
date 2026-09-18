import { pool } from '../../utils/db'
import { TASK_SELECT } from '../../utils/queries'
import { requireUser } from '../../utils/auth'
import { apiError } from '../../utils/http'
import { logActivity } from '../../utils/activity'
import { buildTaskUpdateEvents } from '../../utils/activityDiff'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const id = getRouterParam(event, 'id')

  const existingResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [id])
  const existing = existingResult.rows[0]
  if (!existing || existing.user_id !== user.sub || existing.org_id !== user.org) {
    throw apiError(404, 'Hittades inte.')
  }

  const b = await readBody(event)
  let newProjectLabel: string | null = null
  if (b.project_id) {
    const { rows } = await pool.query('SELECT project_number, name FROM projects WHERE id = $1 AND org_id = $2', [b.project_id, user.org])
    if (!rows[0]) throw apiError(400, 'Ogiltig referens.')
    newProjectLabel = `${rows[0].project_number} – ${rows[0].name}`
  }

  const newStatus = b.status ?? existing.status
  let completed_at = existing.completed_at
  if (newStatus === 'avslutad' && existing.status !== 'avslutad') {
    completed_at = new Date()
  } else if (newStatus !== 'avslutad') {
    completed_at = null
  }
  const newProjectId = b.project_id !== undefined ? b.project_id : existing.project_id
  const finalDueDate = b.due_date ?? existing.due_date

  const updated = await pool.query(
    `UPDATE tasks SET project_id=$1, title=$2, notes=$3, status=$4, due_date=$5, completed_at=$6
     WHERE id=$7 RETURNING id`,
    [newProjectId, b.title ?? existing.title, b.notes ?? existing.notes, newStatus, finalDueDate, completed_at, id]
  )

  const events = buildTaskUpdateEvents(
    { title: existing.title, status: existing.status, due_date: existing.due_date },
    { status: newStatus, due_date: finalDueDate }
  )

  // Byte av projekt (task.assigned) kräver namn-lookup, hanteras separat från
  // de rena diff-funktionerna som inte gör DB-anrop.
  if (b.project_id !== undefined && b.project_id !== existing.project_id) {
    let fromLabel: string | null = null
    if (existing.project_id) {
      const { rows } = await pool.query('SELECT project_number, name FROM projects WHERE id = $1', [existing.project_id])
      if (rows[0]) fromLabel = `${rows[0].project_number} – ${rows[0].name}`
    }
    events.push({
      eventType: 'task.assigned',
      metadata: { title: existing.title, from_project: fromLabel, to_project: newProjectLabel },
    })
  }

  for (const e of events) {
    await logActivity(
      pool,
      {
        orgId: user.org,
        userId: user.sub,
        entityType: 'task',
        entityId: Number(id),
        projectId: newProjectId || null,
        eventType: e.eventType,
        metadata: e.metadata,
      },
      { bestEffort: true }
    )
  }

  const { rows } = await pool.query(`${TASK_SELECT} WHERE t.id = $1`, [updated.rows[0].id])
  return rows[0]
})
