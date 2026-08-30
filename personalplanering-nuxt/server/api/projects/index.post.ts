import { pool, nextProjectNumber } from '../../utils/db'
import { requireOrg } from '../../utils/auth'
import { assertDepartmentKey } from '../../utils/departments'
import { PROJECT_SELECT } from '../../utils/queries'
import { apiError } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const b = await readBody(event)
  const { name, client, project_manager_user_id, sum, start_date, end_date, status, notes, category } = b || {}
  if (!name) {
    throw apiError(400, 'Namn krävs.')
  }
  await assertDepartmentKey(pool, orgId, category)

  if (project_manager_user_id) {
    const { rowCount } = await pool.query(
      'SELECT 1 FROM users WHERE id = $1 AND org_id = $2',
      [project_manager_user_id, orgId]
    )
    if (!rowCount) throw apiError(400, 'Ogiltig projektledare.')
  }

  const project_number = await nextProjectNumber(orgId)
  const inserted = await pool.query(
    `INSERT INTO projects (org_id, project_number, name, client, project_manager_user_id, sum, start_date, end_date, status, notes, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      orgId,
      project_number,
      name,
      client || null,
      project_manager_user_id || null,
      sum === '' || sum === undefined ? null : sum,
      start_date || null,
      end_date || null,
      status || 'aktiv',
      notes || null,
      category || null,
    ]
  )
  const { rows } = await pool.query(`${PROJECT_SELECT} WHERE p.id = $1`, [inserted.rows[0].id])
  setResponseStatus(event, 201)
  return rows[0]
})
