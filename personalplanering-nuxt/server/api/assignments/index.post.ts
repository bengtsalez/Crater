import { pool } from '../../utils/db'
import { requireOrg } from '../../utils/auth'
import { ASSIGNMENT_SELECT } from '../../utils/queries'
import { apiError } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const b = await readBody(event)
  const { resource_id, project_id, start_date, end_date, note } = b || {}
  if (!resource_id || !project_id || !start_date || !end_date) {
    throw apiError(400, 'Resurs, projekt, startdatum och slutdatum krävs.')
  }
  if (end_date < start_date) {
    throw apiError(400, 'Slutdatum kan inte vara före startdatum.')
  }

  const refs = await pool.query(
    `SELECT
       (SELECT 1 FROM resources WHERE id = $1 AND org_id = $3) AS has_resource,
       (SELECT 1 FROM projects WHERE id = $2 AND org_id = $3) AS has_project`,
    [resource_id, project_id, orgId]
  )
  if (!refs.rows[0].has_resource || !refs.rows[0].has_project) {
    throw apiError(400, 'Ogiltig referens.')
  }

  const inserted = await pool.query(
    `INSERT INTO assignments (org_id, resource_id, project_id, start_date, end_date, note)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [orgId, resource_id, project_id, start_date, end_date, note || null]
  )
  const { rows } = await pool.query(`${ASSIGNMENT_SELECT} WHERE a.id = $1`, [inserted.rows[0].id])
  setResponseStatus(event, 201)
  return rows[0]
})
