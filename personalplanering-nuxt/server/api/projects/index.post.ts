import { pool, nextProjectNumber } from '../../utils/db'
import { requireOrg } from '../../utils/auth'
import { assertDepartmentKey } from '../../utils/departments'
import { PROJECT_SELECT } from '../../utils/queries'
import { apiError } from '../../utils/http'

const STATUS_VALUES = ['aktiv', 'planerad', 'avslutad']

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const b = await readBody(event)
  const { name, client, project_manager_user_id, sum, start_date, end_date, status_override, notes, category } =
    b || {}
  if (!name) {
    throw apiError(400, 'Namn krävs.')
  }
  const override = status_override && STATUS_VALUES.includes(status_override) ? status_override : null
  await assertDepartmentKey(pool, orgId, category)

  if (project_manager_user_id) {
    const { rowCount } = await pool.query(
      'SELECT 1 FROM users WHERE id = $1 AND org_id = $2',
      [project_manager_user_id, orgId]
    )
    if (!rowCount) throw apiError(400, 'Ogiltig projektledare.')
  }

  const project_number = await nextProjectNumber(orgId)
  // Nyskapat projekt är alltid "aktiv" (inga bokningar ännu). En ev. manuell
  // override kan sättas direkt; annars styr automatiken framåt.
  const inserted = await pool.query(
    `INSERT INTO projects (org_id, project_number, name, client, project_manager_user_id, sum, start_date, end_date, status, status_override, notes, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      orgId,
      project_number,
      name,
      client || null,
      project_manager_user_id || null,
      sum === '' || sum === undefined ? null : sum,
      start_date || null,
      end_date || null,
      override || 'aktiv',
      override,
      notes || null,
      category || null,
    ]
  )
  const { rows } = await pool.query(`${PROJECT_SELECT} WHERE p.id = $1`, [inserted.rows[0].id])
  setResponseStatus(event, 201)
  return rows[0]
})
