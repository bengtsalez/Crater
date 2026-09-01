import { pool } from '../../utils/db'
import { requireOrg } from '../../utils/auth'
import { clearStatusOverride, refreshProjectStatuses } from '../../utils/projectStatus'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = getRouterParam(event, 'id')
  const { rows } = await pool.query(
    'DELETE FROM assignments WHERE id = $1 AND org_id = $2 RETURNING project_id',
    [id, orgId]
  )
  if (rows[0]) {
    // Bokning borttagen → automatiken avgör om projektet blir aktiv/planerad/avslutad.
    await clearStatusOverride(orgId, rows[0].project_id)
    await refreshProjectStatuses(orgId)
  }
  setResponseStatus(event, 204)
  return null
})
