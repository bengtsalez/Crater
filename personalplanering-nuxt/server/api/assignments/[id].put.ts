import { pool } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { ASSIGNMENT_SELECT } from '../../utils/queries'
import { apiError } from '../../utils/http'
import { clearStatusOverride, refreshProjectStatuses } from '../../utils/projectStatus'
import { syncProjectDatesToAssignments } from '../../utils/projectDates'
import { logActivity } from '../../utils/activity'
import { buildAssignmentRescheduleEvent } from '../../utils/activityDiff'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const orgId = user.org
  const id = getRouterParam(event, 'id')
  const existingResult = await pool.query(
    `SELECT a.*, r.name AS resource_name FROM assignments a
     JOIN resources r ON r.id = a.resource_id AND r.org_id = a.org_id
     WHERE a.id = $1 AND a.org_id = $2`,
    [id, orgId]
  )
  const existing = existingResult.rows[0]
  if (!existing) throw apiError(404, 'Hittades inte.')

  const b = await readBody(event)
  const start_date = b.start_date ?? existing.start_date
  const end_date = b.end_date ?? existing.end_date
  if (end_date < start_date) {
    throw apiError(400, 'Slutdatum kan inte vara före startdatum.')
  }

  const resource_id = b.resource_id ?? existing.resource_id
  const project_id = b.project_id ?? existing.project_id
  let resourceName = existing.resource_name
  if (resource_id !== existing.resource_id || project_id !== existing.project_id) {
    const refs = await pool.query(
      `SELECT
         (SELECT name FROM resources WHERE id = $1 AND org_id = $3) AS resource_name,
         (SELECT 1 FROM projects WHERE id = $2 AND org_id = $3) AS has_project`,
      [resource_id, project_id, orgId]
    )
    if (!refs.rows[0].resource_name || !refs.rows[0].has_project) {
      throw apiError(400, 'Ogiltig referens.')
    }
    resourceName = refs.rows[0].resource_name
  }

  await pool.query(
    'UPDATE assignments SET resource_id=$1, project_id=$2, start_date=$3, end_date=$4, note=$5 WHERE id=$6 AND org_id=$7',
    [resource_id, project_id, start_date, end_date, b.note ?? existing.note, id, orgId]
  )
  // Bokningen (och ev. dess projekt) har ändrats → nollställ override och räkna om.
  await clearStatusOverride(orgId, existing.project_id)
  if (project_id !== existing.project_id) await clearStatusOverride(orgId, project_id)
  if (b.sync_project_dates) {
    await syncProjectDatesToAssignments(orgId, project_id)
    if (project_id !== existing.project_id) {
      await syncProjectDatesToAssignments(orgId, existing.project_id)
    }
  }
  await refreshProjectStatuses(orgId)

  const updateEvent = buildAssignmentRescheduleEvent(
    {
      start_date: existing.start_date,
      end_date: existing.end_date,
      resource_id: existing.resource_id,
      project_id: existing.project_id,
    },
    { start_date, end_date, resource_id, project_id },
    resourceName
  )
  if (updateEvent) {
    await logActivity(
      pool,
      {
        orgId,
        userId: user.sub,
        entityType: 'assignment',
        entityId: Number(id),
        projectId: project_id,
        eventType: updateEvent.eventType,
        metadata: updateEvent.metadata,
      },
      { bestEffort: true }
    )
  }

  const { rows } = await pool.query(`${ASSIGNMENT_SELECT} WHERE a.id = $1`, [id])
  return rows[0]
})
