import { pool } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { apiError } from '../../utils/http'
import { logActivity } from '../../utils/activity'
import { buildLineItemUpdateEvent, type LineItemDiffRow } from '../../utils/activityDiff'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const orgId = user.org
  const id = getRouterParam(event, 'id')
  const existingResult = await pool.query('SELECT * FROM project_line_items WHERE id = $1 AND org_id = $2', [id, orgId])
  const existing = existingResult.rows[0]
  if (!existing) throw apiError(404, 'Hittades inte.')

  const b = await readBody(event)
  const { rows } = await pool.query(
    `UPDATE project_line_items SET description=$1, amount=$2, date=$3, notes=$4 WHERE id=$5 AND org_id=$6 RETURNING *`,
    [
      b.description ?? existing.description,
      b.amount ?? existing.amount,
      b.date ?? existing.date,
      b.notes ?? existing.notes,
      id,
      orgId,
    ]
  )

  const existingDiff: LineItemDiffRow = {
    type: existing.type,
    description: existing.description,
    amount: existing.amount,
    date: existing.date,
    notes: existing.notes,
  }
  const nextDiff: Partial<LineItemDiffRow> = {}
  if (b.description !== undefined) nextDiff.description = b.description
  if (b.amount !== undefined) nextDiff.amount = b.amount
  if (b.date !== undefined) nextDiff.date = b.date
  if (b.notes !== undefined) nextDiff.notes = b.notes
  const updateEvent = buildLineItemUpdateEvent(existingDiff, nextDiff)
  if (updateEvent) {
    await logActivity(
      pool,
      {
        orgId,
        userId: user.sub,
        entityType: 'line_item',
        entityId: Number(id),
        projectId: existing.project_id,
        eventType: updateEvent.eventType,
        metadata: updateEvent.metadata,
      },
      { bestEffort: true }
    )
  }

  return rows[0]
})
