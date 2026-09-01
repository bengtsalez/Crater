import { pool } from '../../utils/db'
import { requireOrg } from '../../utils/auth'
import { ASSIGNMENT_SELECT } from '../../utils/queries'
import { apiError } from '../../utils/http'
import { clearStatusOverride, refreshProjectStatuses } from '../../utils/projectStatus'
import { syncProjectDatesToAssignments } from '../../utils/projectDates'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = getRouterParam(event, 'id')
  const existingResult = await pool.query('SELECT * FROM assignments WHERE id = $1 AND org_id = $2', [id, orgId])
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
  if (resource_id !== existing.resource_id || project_id !== existing.project_id) {
    const refs = await pool.query(
      `SELECT
         (SELECT 1 FROM resources WHERE id = $1 AND org_id = $3) AS has_resource,
         (SELECT 1 FROM projects WHERE id = $2 AND org_id = $3) AS has_project`,
      [resource_id, project_id, orgId]
    )
    if (!refs.rows[0].has_resource || !refs.rows[0].has_project) {
      throw apiError(400, 'Ogiltig referens.')
    }
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

  const { rows } = await pool.query(`${ASSIGNMENT_SELECT} WHERE a.id = $1`, [id])
  return rows[0]
})
