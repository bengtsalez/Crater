// Egenkontroller – avvikelser: lista, uppdatera, åtgärda, verifiera,
// återöppna och koppla till en befintlig uppgift.
//
// Nitro-fri (testas med PGlite). Regler:
//  - Avvikelser skapas från ett svar "Avvikelse" (se saveAnswer) – samma öppna
//    avvikelse uppdateras vid upprepade sparningar.
//  - Personal (ansvarig för kontrollen) kan dokumentera åtgärd. Bara
//    projektledare/administratör verifierar och återöppnar (med motivering).
//  - När kontrollen är godkänd eller arkiverad är avvikelserna låsta.
//  - `rev` skyddar mot att ett äldre formulär skriver över nyare uppgifter.

import type { DeviationListRow } from '../../shared/inspectionTypes'
import { DEVIATION_STATUSES } from '../../shared/inspections'
import {
  inspectionActivity,
  InspectionError,
  inspDate,
  inspId,
  inspText,
  isInspectionReviewer,
  loadInspectionRow,
  mapDeviationRow,
  requireInspectionReviewer,
  resolveResponsible,
  type InspectionActor,
  type InspectionDb,
  type InspQueryable,
} from './inspectionCore'

const DEV_NOT_FOUND = 'Avvikelsen hittades inte.'

export async function listDeviations(
  q: InspQueryable,
  actor: InspectionActor,
  filter: { project_id?: unknown; responsible_user_id?: unknown; status?: unknown } = {}
): Promise<DeviationListRow[]> {
  requireInspectionReviewer(actor)
  const params: unknown[] = [actor.orgId]
  const where = ['d.org_id = $1']
  if (filter.project_id !== undefined && filter.project_id !== '') {
    params.push(inspId(filter.project_id) ?? -1)
    where.push(`d.project_id = $${params.length}`)
  }
  if (filter.responsible_user_id !== undefined && filter.responsible_user_id !== '') {
    params.push(inspId(filter.responsible_user_id) ?? -1)
    where.push(`d.responsible_user_id = $${params.length}`)
  }
  if (filter.status === 'unverified') {
    where.push("d.status <> 'verified'")
  } else if (typeof filter.status === 'string' && (DEVIATION_STATUSES as readonly string[]).includes(filter.status)) {
    params.push(filter.status)
    where.push(`d.status = $${params.length}`)
  }
  const { rows } = await q.query(
    `SELECT d.*, it.title AS item_title, p.project_number, p.name AS project_name,
            i.name AS inspection_name, i.location AS inspection_location, i.status AS inspection_status
     FROM inspection_deviations d
     JOIN inspection_items it ON it.id = d.item_id
     JOIN inspections i ON i.id = d.inspection_id AND i.org_id = d.org_id
     JOIN projects p ON p.id = d.project_id AND p.org_id = d.org_id
     WHERE ${where.join(' AND ')}
     ORDER BY (d.status = 'verified'), d.due_date NULLS LAST, d.created_at DESC, d.id DESC
     LIMIT 500`,
    params
  )
  return rows.map((r) => ({
    ...mapDeviationRow(r, []),
    project_number: r.project_number,
    project_name: r.project_name,
    inspection_name: r.inspection_name,
    inspection_location: r.inspection_location ?? null,
    inspection_status: r.inspection_status,
  }))
}

/** Låser kontroll + avvikelse; kontrollerar åtkomst och att avvikelsen hör till kontrollen. */
async function lockDeviation(q: InspQueryable, actor: InspectionActor, inspectionId: unknown, deviationId: unknown, rev: unknown) {
  const row = await loadInspectionRow(q, actor, inspectionId, { forUpdate: true })
  const did = inspId(deviationId)
  const dev = did
    ? (
        await q.query(
          `SELECT d.*, it.title AS item_title FROM inspection_deviations d JOIN inspection_items it ON it.id = d.item_id
           WHERE d.id = $1 AND d.inspection_id = $2 AND d.org_id = $3 FOR UPDATE OF d`,
          [did, row.id, actor.orgId]
        )
      ).rows[0]
    : null
  if (!dev) throw new InspectionError(404, DEV_NOT_FOUND)
  if (row.status === 'approved' || row.status === 'archived' || row.superseded_by_id !== null) {
    throw new InspectionError(409, 'Kontrollen är låst – avvikelsen kan inte ändras.', 'locked')
  }
  if (rev !== undefined && Number(rev) !== Number(dev.rev)) {
    throw new InspectionError(409, 'Avvikelsen har ändrats av någon annan. Ladda om och försök igen.', 'conflict')
  }
  return { row, dev }
}

async function history(
  q: InspQueryable,
  actor: InspectionActor,
  devId: number,
  type: string,
  from: string | null,
  to: string | null,
  data: Record<string, unknown>
) {
  await q.query(
    `INSERT INTO inspection_deviation_history (org_id, deviation_id, event_type, from_status, to_status, data, user_id, user_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actor.orgId, devId, type, from, to, JSON.stringify(data), actor.userId, actor.name]
  )
}

export async function updateDeviation(
  db: InspectionDb,
  actor: InspectionActor,
  inspectionId: unknown,
  deviationId: unknown,
  input: { description?: unknown; responsible_user_id?: unknown; due_date?: unknown; rev?: unknown }
) {
  await db.tx(async (q) => {
    const { row, dev } = await lockDeviation(q, actor, inspectionId, deviationId, input.rev)
    const reviewer = isInspectionReviewer(actor)
    if (!reviewer && (input.responsible_user_id !== undefined || input.due_date !== undefined)) {
      throw new InspectionError(403, 'Endast projektledare eller administratör kan ändra ansvarig och sista datum.')
    }
    const description = input.description !== undefined ? inspText(input.description, 'Beskrivning', 4000, true)! : dev.description
    let responsible = dev.responsible_user_id ? { id: dev.responsible_user_id, name: dev.responsible_name } : null
    if (input.responsible_user_id !== undefined) responsible = await resolveResponsible(q, actor, input.responsible_user_id)
    const dueDate = input.due_date !== undefined ? inspDate(input.due_date, 'Sista datum') : dev.due_date
    await q.query(
      `UPDATE inspection_deviations SET description = $1, responsible_user_id = $2, responsible_name = $3, due_date = $4,
         rev = rev + 1, updated_at = now() WHERE id = $5`,
      [description, responsible?.id ?? null, responsible?.name ?? null, dueDate, dev.id]
    )
    await history(q, actor, Number(dev.id), 'updated', dev.status, dev.status, {
      description: description !== dev.description ? { old: dev.description, new: description } : undefined,
      responsible: (responsible?.id ?? null) !== (dev.responsible_user_id ?? null) ? responsible?.name ?? null : undefined,
      due_date: dueDate !== dev.due_date ? dueDate : undefined,
    })
    void row
  })
}

export async function resolveDeviation(
  db: InspectionDb,
  actor: InspectionActor,
  inspectionId: unknown,
  deviationId: unknown,
  input: { action_description?: unknown; rev?: unknown }
) {
  const action = inspText(input.action_description, 'Åtgärdsbeskrivning', 4000, true)!
  await db.tx(async (q) => {
    const { row, dev } = await lockDeviation(q, actor, inspectionId, deviationId, input.rev)
    if (dev.status !== 'open') throw new InspectionError(409, 'Endast en öppen avvikelse kan markeras som åtgärdad.', 'invalid_transition')
    await q.query(
      `UPDATE inspection_deviations SET status = 'resolved', action_description = $1, resolved_by_user_id = $2,
         resolved_by_name = $3, resolved_at = now(), rev = rev + 1, updated_at = now() WHERE id = $4`,
      [action, actor.userId, actor.name, dev.id]
    )
    await history(q, actor, Number(dev.id), 'resolved', 'open', 'resolved', { action_description: action })
    await inspectionActivity(q, actor, {
      entityType: 'inspection_deviation',
      entityId: Number(dev.id),
      projectId: row.project_id,
      eventType: 'deviation.resolved',
      metadata: { inspection: row.name, location: row.location, item: dev.item_title, action_description: action },
    })
  })
}

export async function verifyDeviation(
  db: InspectionDb,
  actor: InspectionActor,
  inspectionId: unknown,
  deviationId: unknown,
  input: { rev?: unknown } = {}
) {
  requireInspectionReviewer(actor)
  await db.tx(async (q) => {
    const { row, dev } = await lockDeviation(q, actor, inspectionId, deviationId, input.rev)
    if (dev.status !== 'resolved') {
      throw new InspectionError(409, 'Avvikelsen måste vara åtgärdad innan den kan verifieras.', 'invalid_transition')
    }
    await q.query(
      `UPDATE inspection_deviations SET status = 'verified', verified_by_user_id = $1, verified_by_name = $2, verified_at = now(),
         rev = rev + 1, updated_at = now() WHERE id = $3`,
      [actor.userId, actor.name, dev.id]
    )
    await history(q, actor, Number(dev.id), 'verified', 'resolved', 'verified', {})
    await inspectionActivity(q, actor, {
      entityType: 'inspection_deviation',
      entityId: Number(dev.id),
      projectId: row.project_id,
      eventType: 'deviation.verified',
      metadata: { inspection: row.name, location: row.location, item: dev.item_title },
    })
  })
}

export async function reopenDeviation(
  db: InspectionDb,
  actor: InspectionActor,
  inspectionId: unknown,
  deviationId: unknown,
  input: { reason?: unknown; rev?: unknown }
) {
  requireInspectionReviewer(actor)
  const reason = inspText(input.reason, 'Motivering', 2000, true)!
  await db.tx(async (q) => {
    const { row, dev } = await lockDeviation(q, actor, inspectionId, deviationId, input.rev)
    if (dev.status === 'open') throw new InspectionError(409, 'Avvikelsen är redan öppen.', 'invalid_transition')
    // Tidigare åtgärd och verifiering ligger kvar i historiken.
    await q.query(
      `UPDATE inspection_deviations SET status = 'open', reopen_reason = $1, verified_by_user_id = NULL, verified_by_name = NULL,
         verified_at = NULL, rev = rev + 1, updated_at = now() WHERE id = $2`,
      [reason, dev.id]
    )
    await history(q, actor, Number(dev.id), 'reopened', dev.status, 'open', {
      reason,
      previous_action: dev.action_description,
      previous_resolved_by: dev.resolved_by_name,
    })
    await inspectionActivity(q, actor, {
      entityType: 'inspection_deviation',
      entityId: Number(dev.id),
      projectId: row.project_id,
      eventType: 'deviation.reopened',
      metadata: { inspection: row.name, location: row.location, item: dev.item_title, reason },
    })
  })
}

/**
 * Kopplar avvikelsen till en befintlig uppgift (tasks). Idempotent: finns en
 * kopplad uppgift returneras den – aldrig en ny per anrop.
 */
export async function linkDeviationTask(db: InspectionDb, actor: InspectionActor, inspectionId: unknown, deviationId: unknown) {
  requireInspectionReviewer(actor)
  return db.tx(async (q) => {
    const { row, dev } = await lockDeviation(q, actor, inspectionId, deviationId, undefined)
    if (dev.task_id) {
      const t = (await q.query('SELECT id FROM tasks WHERE id = $1 AND org_id = $2', [dev.task_id, actor.orgId])).rows[0]
      if (t) return { task_id: Number(t.id), created: false }
    }
    const assignee = dev.responsible_user_id ? await resolveResponsible(q, actor, dev.responsible_user_id).catch(() => null) : null
    const title = `Åtgärda avvikelse: ${dev.item_title}${row.location ? ` (${row.location})` : ''}`.slice(0, 300)
    const notes = `${dev.description}\n\nKontroll: ${row.name}${row.location ? `, ${row.location}` : ''}`
    const { rows } = await q.query(
      `INSERT INTO tasks (org_id, user_id, project_id, title, notes, due_date, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [actor.orgId, assignee?.id ?? actor.userId, row.project_id, title, notes, dev.due_date, actor.userId]
    )
    const taskId = Number(rows[0].id)
    await q.query('UPDATE inspection_deviations SET task_id = $1, rev = rev + 1, updated_at = now() WHERE id = $2', [taskId, dev.id])
    await history(q, actor, Number(dev.id), 'task_linked', dev.status, dev.status, { task_id: taskId })
    return { task_id: taskId, created: true }
  })
}
