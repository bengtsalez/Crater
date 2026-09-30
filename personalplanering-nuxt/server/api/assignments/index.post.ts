import { pool } from '../../utils/db'
import { requireInternal } from '../../utils/auth'
import { ASSIGNMENT_SELECT } from '../../utils/queries'
import { apiError } from '../../utils/http'
import { clearStatusOverride, refreshProjectStatuses } from '../../utils/projectStatus'
import { syncProjectDatesToAssignments } from '../../utils/projectDates'
import { logActivity } from '../../utils/activity'

export default defineEventHandler(async (event) => {
  const user = requireInternal(event)
  const orgId = user.org
  const b = await readBody(event)
  const { resource_id, project_id, start_date, end_date, note, sync_project_dates } = b || {}
  if (!resource_id || !project_id || !start_date || !end_date) {
    throw apiError(400, 'Resurs, projekt, startdatum och slutdatum krävs.')
  }
  if (end_date < start_date) {
    throw apiError(400, 'Slutdatum kan inte vara före startdatum.')
  }

  const refs = await pool.query(
    `SELECT
       (SELECT name FROM resources WHERE id = $1 AND org_id = $3) AS resource_name,
       (SELECT 1 FROM projects WHERE id = $2 AND org_id = $3) AS has_project`,
    [resource_id, project_id, orgId]
  )
  if (!refs.rows[0].resource_name || !refs.rows[0].has_project) {
    throw apiError(400, 'Ogiltig referens.')
  }

  const inserted = await pool.query(
    `INSERT INTO assignments (org_id, resource_id, project_id, start_date, end_date, note)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [orgId, resource_id, project_id, start_date, end_date, note || null]
  )
  // Ny bokning → projektet är inplanerat igen; låt automatiken styra statusen.
  await clearStatusOverride(orgId, project_id)
  if (sync_project_dates) await syncProjectDatesToAssignments(orgId, project_id)
  await refreshProjectStatuses(orgId)

  await logActivity(
    pool,
    {
      orgId,
      userId: user.sub,
      entityType: 'assignment',
      entityId: inserted.rows[0].id,
      projectId: project_id,
      eventType: 'assignment.created',
      metadata: { resource_name: refs.rows[0].resource_name, start_date, end_date },
    },
    { bestEffort: true }
  )

  const { rows } = await pool.query(`${ASSIGNMENT_SELECT} WHERE a.id = $1`, [inserted.rows[0].id])
  setResponseStatus(event, 201)
  return rows[0]
})
