import { pool } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { clearStatusOverride, refreshProjectStatuses } from '../../utils/projectStatus'
import { logActivity } from '../../utils/activity'

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
  if (existing) {
    await pool.query('DELETE FROM assignments WHERE id = $1 AND org_id = $2', [id, orgId])
    // Bokning borttagen → automatiken avgör om projektet blir aktiv/planerad/avslutad.
    await clearStatusOverride(orgId, existing.project_id)
    await refreshProjectStatuses(orgId)

    await logActivity(
      pool,
      {
        orgId,
        userId: user.sub,
        entityType: 'assignment',
        entityId: Number(id),
        projectId: existing.project_id,
        eventType: 'assignment.deleted',
        metadata: { resource_name: existing.resource_name, start_date: existing.start_date, end_date: existing.end_date },
      },
      { bestEffort: true }
    )
  }
  setResponseStatus(event, 204)
  return null
})
