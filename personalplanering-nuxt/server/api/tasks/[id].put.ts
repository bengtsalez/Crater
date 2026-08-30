import { pool } from '../../utils/db'
import { TASK_SELECT } from '../../utils/queries'
import { requireUser } from '../../utils/auth'
import { apiError } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const id = getRouterParam(event, 'id')

  const existingResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [id])
  const existing = existingResult.rows[0]
  if (!existing || existing.user_id !== user.sub || existing.org_id !== user.org) {
    throw apiError(404, 'Hittades inte.')
  }

  const b = await readBody(event)
  if (b.project_id) {
    const { rowCount } = await pool.query('SELECT 1 FROM projects WHERE id = $1 AND org_id = $2', [b.project_id, user.org])
    if (!rowCount) throw apiError(400, 'Ogiltig referens.')
  }

  const newStatus = b.status ?? existing.status
  let completed_at = existing.completed_at
  if (newStatus === 'avslutad' && existing.status !== 'avslutad') {
    completed_at = new Date()
  } else if (newStatus !== 'avslutad') {
    completed_at = null
  }

  const updated = await pool.query(
    `UPDATE tasks SET project_id=$1, title=$2, notes=$3, status=$4, due_date=$5, completed_at=$6
     WHERE id=$7 RETURNING id`,
    [
      b.project_id !== undefined ? b.project_id : existing.project_id,
      b.title ?? existing.title,
      b.notes ?? existing.notes,
      newStatus,
      b.due_date ?? existing.due_date,
      completed_at,
      id,
    ]
  )
  const { rows } = await pool.query(`${TASK_SELECT} WHERE t.id = $1`, [updated.rows[0].id])
  return rows[0]
})
