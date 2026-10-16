// Egenkontroller – statusövergångar och granskning.
//
// Nitro-fri (testas med PGlite). Varje övergång:
//  1. låser kontrollraden (FOR UPDATE) – samtidiga/dubbla anrop serialiseras
//     och det andra ser den nya statusen och nekas med 409 (inga dubbletter),
//  2. validerar övergången mot INSPECTION_TRANSITIONS och aktörens roll,
//  3. skriver status, granskningshändelse och aktivitet i samma transaktion.
//
// Inlämning kräver att alla krav är uppfyllda (öppna avvikelser är tillåtna).
// Godkännande kräver dessutom att inga avvikelser är Öppna eller Åtgärdade,
// låser innehållet och sparar en fullständig ögonblicksbild för PDF.

import {
  INSPECTION_STATUS_LABELS,
  INSPECTION_TRANSITIONS,
  type InspectionAction,
  type InspectionStatus,
} from '../../shared/inspections'
import {
  assertInspectionCurrent,
  buildInspectionSnapshot,
  inspectionActivity,
  inspectionEvent,
  InspectionError,
  inspText,
  isInspectionReviewer,
  loadInspectionContent,
  loadInspectionRow,
  type InspectionActor,
  type InspectionDb,
} from './inspectionCore'

export async function transitionInspection(
  db: InspectionDb,
  actor: InspectionActor,
  id: unknown,
  action: unknown,
  input: { comment?: unknown; lock_version?: unknown } = {}
): Promise<void> {
  if (typeof action !== 'string' || !(action in INSPECTION_TRANSITIONS)) throw new InspectionError(400, 'Ogiltig åtgärd.')
  const act = action as InspectionAction
  const rule = INSPECTION_TRANSITIONS[act]
  if (act !== 'submit' && !isInspectionReviewer(actor)) {
    throw new InspectionError(403, 'Endast projektledare eller administratör kan granska, godkänna eller arkivera kontroller.')
  }
  const comment = inspText(input.comment, 'Kommentar', 4000, act === 'request_changes')

  await db.tx(async (q) => {
    const row = await loadInspectionRow(q, actor, id, { forUpdate: true })
    assertInspectionCurrent(row)
    const from = row.status as InspectionStatus
    if (!rule.from.includes(from)) {
      throw new InspectionError(
        409,
        from === rule.to
          ? `Kontrollen har redan status "${INSPECTION_STATUS_LABELS[from]}".`
          : `Kan inte gå från "${INSPECTION_STATUS_LABELS[from]}" till "${INSPECTION_STATUS_LABELS[rule.to]}".`,
        'invalid_transition'
      )
    }
    if (input.lock_version !== undefined && Number(input.lock_version) !== Number(row.lock_version)) {
      throw new InspectionError(409, 'Kontrollen har ändrats sedan du öppnade den. Ladda om och försök igen.', 'conflict')
    }
    if (act === 'submit' && !isInspectionReviewer(actor) && row.responsible_user_id !== actor.userId) {
      throw new InspectionError(403, 'Endast ansvarig kan lämna in kontrollen.')
    }

    if (act === 'submit' || act === 'approve') {
      const content = await loadInspectionContent(q, actor.orgId, Number(row.id))
      const problems = content.items
        .filter((it) => !it.evaluation.complete)
        .map((it) => ({ item_id: it.id, title: it.title, problems: it.evaluation.problems }))
      if (problems.length) {
        throw new InspectionError(
          400,
          `${problems.length} ${problems.length === 1 ? 'punkt uppfyller' : 'punkter uppfyller'} inte kraven: ` +
            problems
              .slice(0, 5)
              .map((p) => `${p.title} (${p.problems.join(', ')})`)
              .join('; ') +
            (problems.length > 5 ? ' …' : ''),
          'incomplete',
          { problems }
        )
      }
      if (act === 'approve') {
        const open = content.deviations.filter((d) => d.status !== 'verified')
        if (open.length) {
          throw new InspectionError(
            409,
            `Kontrollen har ${open.length} ${open.length === 1 ? 'avvikelse' : 'avvikelser'} som inte är verifierade. Alla avvikelser måste vara åtgärdade och verifierade före godkännande.`,
            'open_deviations'
          )
        }
      }
    }

    if (act === 'submit') {
      await q.query(
        `UPDATE inspections SET status = 'submitted', submitted_at = now(), submitted_by_user_id = $1, submitted_by_name = $2,
           lock_version = lock_version + 1, updated_at = now() WHERE id = $3`,
        [actor.userId, actor.name, row.id]
      )
    } else if (act === 'request_changes') {
      await q.query(
        `UPDATE inspections SET status = 'changes_requested', review_comment = $1, lock_version = lock_version + 1, updated_at = now()
         WHERE id = $2`,
        [comment, row.id]
      )
    } else if (act === 'approve') {
      // Ögonblicksbilden byggs med godkännandeuppgifterna på plats.
      const approvedAt = new Date().toISOString()
      const snap = await buildInspectionSnapshot(q, actor, {
        ...row,
        status: 'approved',
        approved_at: approvedAt,
        approved_by_name: actor.name,
        approval_comment: comment,
      })
      await q.query(
        `UPDATE inspections SET status = 'approved', approved_at = $1, approved_by_user_id = $2, approved_by_name = $3,
           approval_comment = $4, approved_snapshot = $5, lock_version = lock_version + 1, updated_at = now()
         WHERE id = $6`,
        [approvedAt, actor.userId, actor.name, comment, JSON.stringify(snap), row.id]
      )
    } else {
      await q.query("UPDATE inspections SET status = 'archived', lock_version = lock_version + 1, updated_at = now() WHERE id = $1", [row.id])
    }

    const eventType = { submit: 'submitted', request_changes: 'changes_requested', approve: 'approved', archive: 'archived' }[act]
    await inspectionEvent(q, actor, Number(row.id), { type: eventType, from, to: rule.to, comment })
    await inspectionActivity(q, actor, {
      entityType: 'inspection',
      entityId: Number(row.id),
      projectId: row.project_id,
      eventType: `inspection.${eventType}`,
      metadata: { name: row.name, location: row.location, revision: Number(row.revision), comment },
    })
  })
}
