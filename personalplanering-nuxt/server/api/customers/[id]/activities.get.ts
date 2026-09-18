import { pool } from '../../../utils/db'
import { requireOrg } from '../../../utils/auth'
import { ACTIVITY_SELECT } from '../../../utils/queries'

// Kundens aktivitetsflöde = dess egna kundhändelser PLUS en kurerad delmängd
// av dess projekts händelser (bara created/status_changed/small_job.*) – INTE
// alla projekt-events, annars blir kundflödet lika brusigt som varje ÄTA-
// redigering/uppgift/ombokning på varje kopplat projekt.
const CUSTOMER_RELEVANT_PROJECT_EVENTS = [
  'project.created',
  'project.status_changed',
  'small_job.created',
  'small_job.completed',
]

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = getRouterParam(event, 'id')
  const limitRaw = Number(getQuery(event).limit)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50
  const { rows } = await pool.query(
    `${ACTIVITY_SELECT}
     WHERE ae.org_id = $1
       AND (
         ae.customer_id = $2
         OR (
           ae.project_id IN (SELECT id FROM projects WHERE customer_id = $2 AND org_id = $1)
           AND ae.event_type = ANY($4::text[])
         )
       )
     ORDER BY ae.created_at DESC LIMIT $3`,
    [orgId, id, limit, CUSTOMER_RELEVANT_PROJECT_EVENTS]
  )
  return rows
})
