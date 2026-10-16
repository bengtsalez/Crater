import { pool } from '../../utils/db'
import { requireInternal } from '../../utils/auth'
import { apiError } from '../../utils/http'
import { logActivity } from '../../utils/activity'
import { buildLineItemUpdateEvent, type LineItemDiffRow } from '../../utils/activityDiff'
import { ATA_STATUSES, ataBillingPart } from '../../utils/billing'

export default defineEventHandler(async (event) => {
  const user = requireInternal(event)
  const orgId = user.org
  const id = getRouterParam(event, 'id')
  const existingResult = await pool.query('SELECT * FROM project_line_items WHERE id = $1 AND org_id = $2', [id, orgId])
  const existing = existingResult.rows[0]
  if (!existing) throw apiError(404, 'Hittades inte.')

  const b = await readBody(event)

  // ÄTA-status (utkast/skickad/godkänd/avböjd). En ÄTA som hämtats till
  // fakturering måste förbli godkänd – ta bort faktureringsdelen först.
  let ataStatus: string = existing.ata_status
  if (b.ata_status !== undefined && existing.type === 'ata') {
    if (!ATA_STATUSES.includes(b.ata_status)) throw apiError(400, 'Ogiltig ÄTA-status.')
    ataStatus = b.ata_status
    if (ataStatus !== 'godkand' && existing.ata_status === 'godkand') {
      const part = await ataBillingPart(pool, orgId, Number(id))
      if (part) throw apiError(409, `ÄTA:n är hämtad till fakturering (${part.document_number}) och måste vara godkänd.`)
    }
  }
  const description = b.description ?? existing.description
  const amount = b.amount ?? existing.amount
  // Ny revision när innehållet ändras → öppna faktureringsunderlag visar avvikelse.
  const contentChanged = description !== existing.description || Number(amount) !== Number(existing.amount)

  const { rows } = await pool.query(
    `UPDATE project_line_items SET description=$1, amount=$2, date=$3, notes=$4, ata_status=$7,
       approved_at = CASE WHEN $7 = 'godkand' AND ata_status <> 'godkand' THEN now() WHEN $7 <> 'godkand' THEN NULL ELSE approved_at END,
       approved_by_user_id = CASE WHEN $7 = 'godkand' AND ata_status <> 'godkand' THEN $8::int WHEN $7 <> 'godkand' THEN NULL ELSE approved_by_user_id END,
       revision = revision + $9, updated_at = now()
     WHERE id=$5 AND org_id=$6
       AND NOT ($7 <> 'godkand' AND EXISTS (SELECT 1 FROM billing_parts bp WHERE bp.kind = 'ata' AND bp.ata_line_item_id = $5))
     RETURNING *`,
    [
      description,
      amount,
      b.date ?? existing.date,
      b.notes ?? existing.notes,
      id,
      orgId,
      ataStatus,
      user.sub,
      contentChanged ? 1 : 0,
    ]
  )

  // Atomiskt skydd om ÄTA:n hämtades till fakturering mellan kontrollen ovan och uppdateringen.
  if (!rows[0]) throw apiError(409, 'ÄTA:n är hämtad till fakturering och måste vara godkänd.')

  if (ataStatus !== existing.ata_status) {
    await logActivity(
      pool,
      {
        orgId,
        userId: user.sub,
        entityType: 'line_item',
        entityId: Number(id),
        projectId: existing.project_id,
        eventType: 'line_item.ata_status_changed',
        metadata: { description: rows[0].description, from: existing.ata_status, to: ataStatus },
      },
      { bestEffort: true }
    )
  }

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
