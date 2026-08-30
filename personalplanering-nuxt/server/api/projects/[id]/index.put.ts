import { pool } from '../../../utils/db'
import { requireOrg } from '../../../utils/auth'
import { assertDepartmentKey } from '../../../utils/departments'
import { PROJECT_SELECT } from '../../../utils/queries'
import { apiError } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = getRouterParam(event, 'id')
  const existingResult = await pool.query('SELECT * FROM projects WHERE id = $1 AND org_id = $2', [id, orgId])
  const existing = existingResult.rows[0]
  if (!existing) throw apiError(404, 'Hittades inte.')

  const b = await readBody(event)
  if (b.category) {
    await assertDepartmentKey(pool, orgId, b.category)
  }

  const newPm =
    b.project_manager_user_id !== undefined ? b.project_manager_user_id : existing.project_manager_user_id
  if (newPm) {
    const { rowCount } = await pool.query('SELECT 1 FROM users WHERE id = $1 AND org_id = $2', [newPm, orgId])
    if (!rowCount) throw apiError(400, 'Ogiltig projektledare.')
  }

  await pool.query(
    `UPDATE projects SET project_number=$1, name=$2, client=$3, project_manager_user_id=$4, sum=$5, start_date=$6, end_date=$7, status=$8, notes=$9, category=$10
     WHERE id=$11 AND org_id=$12`,
    [
      b.project_number ?? existing.project_number,
      b.name ?? existing.name,
      b.client ?? existing.client,
      newPm,
      b.sum === '' ? null : b.sum ?? existing.sum,
      b.start_date ?? existing.start_date,
      b.end_date ?? existing.end_date,
      b.status ?? existing.status,
      b.notes ?? existing.notes,
      b.category !== undefined ? b.category || null : existing.category,
      id,
      orgId,
    ]
  )
  const { rows } = await pool.query(`${PROJECT_SELECT} WHERE p.id = $1`, [id])
  return rows[0]
})
