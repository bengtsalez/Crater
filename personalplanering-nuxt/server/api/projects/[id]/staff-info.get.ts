import { pool } from '../../../utils/db'
import { requireOrg } from '../../../utils/auth'
import { apiError } from '../../../utils/http'

// Arbetsinformation till personal (intern redigeringsvy). Separat från
// projects.notes – interna anteckningar blir aldrig synliga för personalen.
export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = Number(getRouterParam(event, 'id'))
  const { rowCount } = await pool.query('SELECT 1 FROM projects WHERE id = $1 AND org_id = $2', [id, orgId])
  if (!rowCount) throw apiError(404, 'Hittades inte.')
  const { rows } = await pool.query(
    `SELECT s.instructions, s.published, s.updated_at, u.username AS updated_by_username
     FROM project_staff_info s
     LEFT JOIN users u ON u.id = s.updated_by_user_id AND u.org_id = s.org_id
     WHERE s.project_id = $1 AND s.org_id = $2`,
    [id, orgId]
  )
  return rows[0] ?? { instructions: '', published: false, updated_at: null, updated_by_username: null }
})
