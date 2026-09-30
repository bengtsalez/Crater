import { pool } from '../../utils/db'
import { requireInternal } from '../../utils/auth'
import { logActivity } from '../../utils/activity'

export default defineEventHandler(async (event) => {
  const user = requireInternal(event)
  const orgId = user.org
  const id = getRouterParam(event, 'id')
  const { rows } = await pool.query(
    'DELETE FROM project_line_items WHERE id = $1 AND org_id = $2 RETURNING *',
    [id, orgId]
  )
  if (rows[0]) {
    await logActivity(
      pool,
      {
        orgId,
        userId: user.sub,
        entityType: 'line_item',
        entityId: rows[0].id,
        projectId: rows[0].project_id,
        eventType: rows[0].type === 'ata' ? 'line_item.ata_deleted' : 'line_item.expense_deleted',
        metadata: { description: rows[0].description, amount: rows[0].amount, date: rows[0].date },
      },
      { bestEffort: true }
    )
  }
  setResponseStatus(event, 204)
  return null
})
