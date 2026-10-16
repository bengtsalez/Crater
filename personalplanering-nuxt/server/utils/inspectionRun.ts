// Egenkontroller – kontroller på projekt: skapa från mall, projektanpassa,
// spara svar (med optimistisk låsning) och skapa revisioner.
//
// Nitro-fri (testas med PGlite). Varje mutation låser kontrollraden
// (SELECT … FOR UPDATE) så att sparning, inlämning och godkännande inte kan
// korsa varandra. Historik och aktivitet skrivs i samma transaktion.

import {
  coverage,
  evaluateItem,
  InspectionValidationError,
  RESULT_VALUES,
  summarizeProjectInspections,
  validateSections,
  type AnswerType,
  type InspectionStatus,
  type TemplateItem,
  type TemplateSection,
} from '../../shared/inspections'
import type { InspectionListRow, InspectionView, ProjectInspectionsView } from '../../shared/inspectionTypes'
import {
  assertInspectionAnswerable,
  assertInspectionCurrent,
  buildInspectionView,
  inspectionActivity,
  inspectionEvent,
  InspectionError,
  inspDate,
  inspId,
  inspIso,
  inspText,
  isInspectionReviewer,
  loadInspectionContent,
  loadInspectionProject,
  loadInspectionRow,
  requireInspectionReviewer,
  resolveResponsible,
  type InspectionActor,
  type InspectionDb,
  type InspQueryable,
} from './inspectionCore'
import { latestPublishedVersion } from './inspectionTemplates'

const MAX_CREATE = 20

// ---------------------------------------------------------------------------
// Listor
// ---------------------------------------------------------------------------

export interface InspectionListFilter {
  project_id?: unknown
  status?: unknown
  responsible_user_id?: unknown
  include_archived?: boolean
}

/**
 * Aktuella kontroller (inte ersatta revisioner). Täckning beräknas per
 * kontroll med samma regler som vid inlämning.
 */
export async function listInspections(
  q: InspQueryable,
  actor: InspectionActor,
  filter: InspectionListFilter = {}
): Promise<InspectionListRow[]> {
  const params: unknown[] = [actor.orgId]
  const where = ['i.org_id = $1', 'i.superseded_by_id IS NULL']
  const projectId = filter.project_id !== undefined ? inspId(filter.project_id) : null
  if (filter.project_id !== undefined && !projectId) return []
  if (projectId) {
    params.push(projectId)
    where.push(`i.project_id = $${params.length}`)
  }
  if (typeof filter.status === 'string' && filter.status) {
    params.push(filter.status)
    where.push(`i.status = $${params.length}`)
  } else if (!filter.include_archived) {
    where.push("i.status <> 'archived'")
  }
  if (filter.responsible_user_id !== undefined && filter.responsible_user_id !== '') {
    params.push(inspId(filter.responsible_user_id) ?? -1)
    where.push(`i.responsible_user_id = $${params.length}`)
  }
  if (!isInspectionReviewer(actor)) {
    if (actor.role !== 'employee' || !actor.resourceId) return []
    params.push(actor.userId, actor.resourceId)
    where.push(`i.responsible_user_id = $${params.length - 1}`)
    where.push(
      `EXISTS (SELECT 1 FROM assignments a WHERE a.org_id = i.org_id AND a.resource_id = $${params.length} AND a.project_id = i.project_id)`
    )
  }
  const { rows } = await q.query(
    `SELECT i.id, i.project_id, p.project_number, p.name AS project_name, p.work_type, i.name, i.kind, i.location,
            i.due_date, i.responsible_user_id, i.responsible_name, i.status, i.revision, i.template_version, i.updated_at,
            (SELECT count(*)::int FROM inspection_deviations d WHERE d.inspection_id = i.id AND d.status <> 'verified') AS open_deviations
     FROM inspections i JOIN projects p ON p.id = i.project_id AND p.org_id = i.org_id
     WHERE ${where.join(' AND ')}
     ORDER BY p.project_number, i.created_at, i.id`,
    params
  )
  if (!rows.length) return []
  const ids = rows.map((r) => Number(r.id))
  // Täckning: punkter + svar + bekräftade foton i en fråga för alla kontroller.
  const { rows: itemRows } = await q.query(
    `SELECT it.inspection_id, it.answer_type, it.required, it.min_photos, it.comment_required,
            a.item_id AS a_item_id, a.result, a.checked, a.text_value, a.number_value::text AS number_value, a.date_value,
            a.comment, a.na_reason,
            (SELECT count(*)::int FROM inspection_attachments at WHERE at.item_id = it.id AND at.status = 'confirmed') AS photos
     FROM inspection_items it LEFT JOIN inspection_answers a ON a.item_id = it.id
     WHERE it.inspection_id = ANY($1::bigint[]) AND it.org_id = $2`,
    [ids, actor.orgId]
  )
  const byInsp = new Map<number, { required: boolean; evaluation: ReturnType<typeof evaluateItem> }[]>()
  for (const r of itemRows) {
    const k = Number(r.inspection_id)
    if (!byInsp.has(k)) byInsp.set(k, [])
    const answer = r.a_item_id
      ? {
          result: r.result ?? null,
          checked: r.checked ?? null,
          text_value: r.text_value ?? null,
          number_value: r.number_value ?? null,
          date_value: r.date_value ?? null,
          comment: r.comment ?? null,
          na_reason: r.na_reason ?? null,
        }
      : null
    byInsp.get(k)!.push({
      required: !!r.required,
      evaluation: evaluateItem(
        { answer_type: r.answer_type, required: !!r.required, min_photos: Number(r.min_photos), comment_required: !!r.comment_required },
        answer,
        Number(r.photos)
      ),
    })
  }
  return rows.map((r) => ({
    id: Number(r.id),
    project_id: Number(r.project_id),
    project_number: r.project_number,
    project_name: r.project_name,
    work_type: r.work_type ?? 'project',
    name: r.name,
    kind: r.kind,
    location: r.location ?? null,
    due_date: r.due_date ?? null,
    responsible_user_id: r.responsible_user_id ?? null,
    responsible_name: r.responsible_name ?? null,
    status: r.status,
    revision: Number(r.revision),
    template_version: Number(r.template_version),
    coverage: coverage(byInsp.get(Number(r.id)) ?? []),
    open_deviations: Number(r.open_deviations),
    updated_at: inspIso(r.updated_at)!,
  }))
}

export async function getProjectInspections(
  q: InspQueryable,
  actor: InspectionActor,
  projectId: unknown
): Promise<ProjectInspectionsView> {
  requireInspectionReviewer(actor)
  const project = await loadInspectionProject(q, actor, projectId)
  const inspections = await listInspections(q, actor, { project_id: project.id })
  return {
    inspections,
    summary: summarizeProjectInspections(inspections.map((i) => ({ status: i.status, open_deviations: i.open_deviations }))),
  }
}

export async function getInspection(
  q: InspQueryable,
  actor: InspectionActor,
  id: unknown,
  storageConfigured: boolean
): Promise<InspectionView> {
  const row = await loadInspectionRow(q, actor, id)
  return buildInspectionView(q, actor, row, storageConfigured)
}

// ---------------------------------------------------------------------------
// Skapa från mall
// ---------------------------------------------------------------------------

async function insertItems(q: InspQueryable, orgId: number, inspectionId: number, sections: TemplateSection[]) {
  let order = 0
  const inserted: { id: number; key: string }[] = []
  for (const s of sections) {
    for (const it of s.items) {
      const { rows } = await q.query(
        `INSERT INTO inspection_items (org_id, inspection_id, item_key, section_title, sort_order, title, instruction,
           basis, basis_url, method, answer_type, unit, required, min_photos, comment_required, critical, timing_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [
          orgId, inspectionId, it.key, s.title ?? '', order++, it.title, it.instruction, it.basis, it.basis_url,
          it.method, it.answer_type, it.unit, it.required, it.min_photos, it.comment_required, it.critical, it.timing_note,
        ]
      )
      inserted.push({ id: Number(rows[0].id), key: it.key })
    }
  }
  return inserted
}

function sectionsOrThrow(raw: unknown): TemplateSection[] {
  try {
    const s = validateSections(raw)
    if (!s.some((x) => x.items.length)) throw new InspectionValidationError('Kontrollen måste ha minst en kontrollpunkt.')
    return s
  } catch (err) {
    if (err instanceof InspectionValidationError) throw new InspectionError(400, err.message)
    throw err
  }
}

export interface CreateInspectionInput {
  template_id: unknown
  location?: unknown
  due_date?: unknown
  responsible_user_id?: unknown
  name?: unknown
}

/** Skapar en eller flera kontroller (t.ex. samma mall för flera etapper). */
export async function createInspections(
  db: InspectionDb,
  actor: InspectionActor,
  projectId: unknown,
  entries: unknown
): Promise<number[]> {
  requireInspectionReviewer(actor)
  if (!Array.isArray(entries) || !entries.length) throw new InspectionError(400, 'Välj minst en mall.')
  if (entries.length > MAX_CREATE) throw new InspectionError(400, `Högst ${MAX_CREATE} kontroller åt gången.`)
  return db.tx(async (q) => {
    const project = await loadInspectionProject(q, actor, projectId)
    const ids: number[] = []
    for (const raw of entries as CreateInspectionInput[]) {
      const v = await latestPublishedVersion(q, actor, raw?.template_id)
      const location = inspText(raw.location, 'Plats eller etapp', 200)
      const dueDate = inspDate(raw.due_date, 'Sista datum')
      const responsible = await resolveResponsible(q, actor, raw.responsible_user_id)
      const name = inspText(raw.name, 'Namn', 200) ?? v.name
      const { rows } = await q.query(
        `INSERT INTO inspections (org_id, project_id, template_id, template_version_id, template_version, name, kind,
           description, location, due_date, responsible_user_id, responsible_name, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [
          actor.orgId, project.id, v.template_id, v.id, v.version, name, v.kind, v.description, location, dueDate,
          responsible?.id ?? null, responsible?.name ?? null, actor.userId,
        ]
      )
      const id = Number(rows[0].id)
      await insertItems(q, actor.orgId, id, (v.content?.sections ?? []) as TemplateSection[])
      await inspectionEvent(q, actor, id, { type: 'created', to: 'draft' })
      await inspectionActivity(q, actor, {
        entityType: 'inspection',
        entityId: id,
        projectId: project.id,
        eventType: 'inspection.created',
        metadata: { name, location, template_version: Number(v.version), responsible: responsible?.name ?? null },
      })
      ids.push(id)
    }
    return ids
  })
}

// ---------------------------------------------------------------------------
// Uppgifter och projektanpassning
// ---------------------------------------------------------------------------

function assertLockVersion(row: any, expected: unknown) {
  if (expected === undefined) return
  if (Number(expected) !== Number(row.lock_version)) {
    throw new InspectionError(
      409,
      'Kontrollen har ändrats av någon annan sedan du öppnade den. Ladda om för att se de senaste uppgifterna.',
      'conflict'
    )
  }
}

export async function updateInspectionMeta(
  db: InspectionDb,
  actor: InspectionActor,
  id: unknown,
  input: { name?: unknown; location?: unknown; due_date?: unknown; responsible_user_id?: unknown; lock_version?: unknown }
) {
  requireInspectionReviewer(actor)
  await db.tx(async (q) => {
    const row = await loadInspectionRow(q, actor, id, { forUpdate: true })
    assertInspectionCurrent(row)
    if (row.status === 'approved' || row.status === 'archived') {
      throw new InspectionError(409, 'Kontrollen är låst. Skapa en ny revision för ändringar.', 'locked')
    }
    assertLockVersion(row, input.lock_version)
    const next = {
      name: input.name !== undefined ? inspText(input.name, 'Namn', 200, true) : row.name,
      location: input.location !== undefined ? inspText(input.location, 'Plats eller etapp', 200) : row.location,
      due_date: input.due_date !== undefined ? inspDate(input.due_date, 'Sista datum') : row.due_date,
      responsible: row.responsible_user_id ? { id: row.responsible_user_id, name: row.responsible_name } : null,
    }
    if (input.responsible_user_id !== undefined) next.responsible = await resolveResponsible(q, actor, input.responsible_user_id)
    const changes: { field: string; old_value: unknown; new_value: unknown }[] = []
    if (next.name !== row.name) changes.push({ field: 'name', old_value: row.name, new_value: next.name })
    if ((next.location ?? null) !== (row.location ?? null)) changes.push({ field: 'location', old_value: row.location, new_value: next.location })
    if ((next.due_date ?? null) !== (row.due_date ?? null)) changes.push({ field: 'due_date', old_value: row.due_date, new_value: next.due_date })
    if ((next.responsible?.id ?? null) !== (row.responsible_user_id ?? null)) {
      changes.push({ field: 'responsible', old_value: row.responsible_name, new_value: next.responsible?.name ?? null })
    }
    if (!changes.length) return
    await q.query(
      `UPDATE inspections SET name = $1, location = $2, due_date = $3, responsible_user_id = $4, responsible_name = $5,
         lock_version = lock_version + 1, updated_at = now()
       WHERE id = $6`,
      [next.name, next.location, next.due_date, next.responsible?.id ?? null, next.responsible?.name ?? null, row.id]
    )
    await inspectionActivity(q, actor, {
      entityType: 'inspection',
      entityId: Number(row.id),
      projectId: row.project_id,
      eventType: 'inspection.updated',
      metadata: { name: next.name, changes },
    })
  })
}

/**
 * Projektanpassning av frågor och krav. Bara i Utkast och innan något svar
 * eller någon bild finns – därefter krävs en ny revision (createRevision).
 */
export async function replaceInspectionItems(
  db: InspectionDb,
  actor: InspectionActor,
  id: unknown,
  rawSections: unknown,
  lockVersion: unknown
) {
  requireInspectionReviewer(actor)
  const sections = sectionsOrThrow(rawSections)
  await db.tx(async (q) => {
    const row = await loadInspectionRow(q, actor, id, { forUpdate: true })
    assertInspectionCurrent(row)
    assertLockVersion(row, lockVersion)
    const { rows } = await q.query(
      `SELECT (SELECT count(*)::int FROM inspection_answers WHERE inspection_id = $1) AS answers,
              (SELECT count(*)::int FROM inspection_attachments WHERE inspection_id = $1 AND status IN ('pending','confirmed')) AS atts`,
      [row.id]
    )
    if (row.status !== 'draft' || rows[0].answers > 0 || rows[0].atts > 0) {
      throw new InspectionError(
        409,
        'Arbetet med kontrollen har påbörjats. Frågor och krav ändras genom en ny revision så att tidigare underlag bevaras.',
        'needs_revision'
      )
    }
    await q.query('DELETE FROM inspection_items WHERE inspection_id = $1', [row.id])
    await insertItems(q, actor.orgId, Number(row.id), sections)
    await q.query('UPDATE inspections SET lock_version = lock_version + 1, updated_at = now() WHERE id = $1', [row.id])
    await inspectionEvent(q, actor, Number(row.id), { type: 'items_customized' })
    await inspectionActivity(q, actor, {
      entityType: 'inspection',
      entityId: Number(row.id),
      projectId: row.project_id,
      eventType: 'inspection.customized',
      metadata: { name: row.name, items: sections.reduce((n, s) => n + s.items.length, 0) },
    })
  })
}

// ---------------------------------------------------------------------------
// Svar
// ---------------------------------------------------------------------------

export interface AnswerInput {
  result?: unknown
  checked?: unknown
  text_value?: unknown
  number_value?: unknown
  date_value?: unknown
  comment?: unknown
  na_reason?: unknown
  /** Revision som klienten utgår från (0 = inget svar ännu). */
  rev?: unknown
}

function normalizeNumber(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d{1,14}(\.\d{1,4})?$/.test(s)) throw new InspectionError(400, 'Mätvärdet måste vara ett tal (högst fyra decimaler).')
  return s
}

function normalizeAnswer(type: AnswerType, input: AnswerInput) {
  const result = input.result === undefined || input.result === null || input.result === '' ? null : input.result
  if (result !== null && !(RESULT_VALUES as readonly unknown[]).includes(result)) throw new InspectionError(400, 'Ogiltigt kontrollresultat.')
  if (type !== 'result' && result === 'ok') throw new InspectionError(400, 'Ogiltigt kontrollresultat för svarstypen.')
  if (input.checked !== undefined && input.checked !== null && typeof input.checked !== 'boolean') {
    throw new InspectionError(400, 'Ogiltigt värde för kryssruta.')
  }
  return {
    result: result as string | null,
    checked: type === 'checkbox' ? ((input.checked as boolean | null | undefined) ?? null) : null,
    text_value: type === 'text' ? inspText(input.text_value, 'Svar', 4000) : null,
    number_value: type === 'number' ? normalizeNumber(input.number_value) : null,
    date_value: type === 'date' ? inspDate(input.date_value, 'Datum') : null,
    comment: inspText(input.comment, 'Kommentar', 4000),
    na_reason: result === 'na' ? inspText(input.na_reason, 'Motivering', 2000) : null,
  }
}

const ANSWER_COLS = ['result', 'checked', 'text_value', 'number_value', 'date_value', 'comment', 'na_reason'] as const

/**
 * Sparar svaret på en punkt. `rev` måste matcha serverns aktuella revision –
 * annars 409 (code 'conflict') och inget skrivs, så ett äldre formulär aldrig
 * skriver över nyare data. Avvikelse skapar/uppdaterar punktens öppna
 * avvikelse (aldrig en dubblett); ett ändrat svar stänger den inte.
 */
export async function saveAnswer(
  db: InspectionDb,
  actor: InspectionActor,
  inspectionId: unknown,
  itemId: unknown,
  input: AnswerInput
): Promise<void> {
  const iid = inspId(itemId)
  await db.tx(async (q) => {
    const row = await loadInspectionRow(q, actor, inspectionId, { forUpdate: true })
    assertInspectionAnswerable(row)
    const item = iid
      ? (await q.query('SELECT * FROM inspection_items WHERE id = $1 AND inspection_id = $2 AND org_id = $3', [iid, row.id, actor.orgId])).rows[0]
      : null
    if (!item) throw new InspectionError(404, 'Kontrollpunkten hittades inte.')
    const next = normalizeAnswer(item.answer_type, input)
    const existing = (
      await q.query(
        `SELECT result, checked, text_value, number_value::text AS number_value, date_value, comment, na_reason, rev
         FROM inspection_answers WHERE item_id = $1 FOR UPDATE`,
        [item.id]
      )
    ).rows[0]
    const currentRev = existing ? Number(existing.rev) : 0
    if (Number(input.rev ?? -1) !== currentRev) {
      throw new InspectionError(
        409,
        'Punkten har sparats av någon annan sedan du öppnade kontrollen. Ladda om för att se det senaste svaret innan du ändrar.',
        'conflict',
        { item_id: Number(item.id), current_rev: currentRev }
      )
    }
    await q.query(
      `INSERT INTO inspection_answers (item_id, org_id, inspection_id, result, checked, text_value, number_value, date_value,
         comment, na_reason, answered_by_user_id, answered_by_name, answered_at, rev)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), 1)
       ON CONFLICT (item_id) DO UPDATE SET
         result = EXCLUDED.result, checked = EXCLUDED.checked, text_value = EXCLUDED.text_value,
         number_value = EXCLUDED.number_value, date_value = EXCLUDED.date_value, comment = EXCLUDED.comment,
         na_reason = EXCLUDED.na_reason, answered_by_user_id = EXCLUDED.answered_by_user_id,
         answered_by_name = EXCLUDED.answered_by_name, answered_at = now(), rev = inspection_answers.rev + 1`,
      [
        item.id, actor.orgId, row.id, next.result, next.checked, next.text_value, next.number_value, next.date_value,
        next.comment, next.na_reason, actor.userId, actor.name,
      ]
    )
    const oldValue = existing ? Object.fromEntries(ANSWER_COLS.map((c) => [c, existing[c] ?? null])) : null
    await q.query(
      `INSERT INTO inspection_answer_history (org_id, inspection_id, item_id, old_value, new_value, user_id, user_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [actor.orgId, row.id, item.id, oldValue ? JSON.stringify(oldValue) : null, JSON.stringify(next), actor.userId, actor.name]
    )
    if (row.status === 'draft') {
      await q.query("UPDATE inspections SET status = 'in_progress', started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1", [row.id])
      await inspectionEvent(q, actor, Number(row.id), { type: 'started', from: 'draft', to: 'in_progress' })
    } else {
      await q.query('UPDATE inspections SET updated_at = now() WHERE id = $1', [row.id])
    }
    // Avvikelse kräver beskrivning – själva avvikelseposten skapas när den finns.
    if (next.result === 'deviation' && next.comment) await upsertDeviationFromAnswer(q, actor, row, item, next.comment)
  })
}

async function upsertDeviationFromAnswer(q: InspQueryable, actor: InspectionActor, row: any, item: any, description: string) {
  const open = (
    await q.query("SELECT * FROM inspection_deviations WHERE item_id = $1 AND status <> 'verified' FOR UPDATE", [item.id])
  ).rows[0]
  if (open) {
    // Samma öppna avvikelse uppdateras – aldrig en dubblett vid upprepad sparning.
    if (open.status === 'open' && open.description !== description) {
      await q.query('UPDATE inspection_deviations SET description = $1, rev = rev + 1, updated_at = now() WHERE id = $2', [description, open.id])
      await q.query(
        `INSERT INTO inspection_deviation_history (org_id, deviation_id, event_type, data, user_id, user_name)
         VALUES ($1,$2,'description_updated',$3,$4,$5)`,
        [actor.orgId, open.id, JSON.stringify({ old: open.description, new: description }), actor.userId, actor.name]
      )
    }
    return
  }
  const { rows } = await q.query(
    `INSERT INTO inspection_deviations (org_id, project_id, inspection_id, item_id, description, responsible_user_id,
       responsible_name, reported_by_user_id, reported_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [actor.orgId, row.project_id, row.id, item.id, description, row.responsible_user_id, row.responsible_name, actor.userId, actor.name]
  )
  const devId = Number(rows[0].id)
  await q.query(
    `INSERT INTO inspection_deviation_history (org_id, deviation_id, event_type, to_status, data, user_id, user_name)
     VALUES ($1,$2,'reported','open',$3,$4,$5)`,
    [actor.orgId, devId, JSON.stringify({ description }), actor.userId, actor.name]
  )
  await inspectionActivity(q, actor, {
    entityType: 'inspection_deviation',
    entityId: devId,
    projectId: row.project_id,
    eventType: 'deviation.reported',
    metadata: { inspection: row.name, location: row.location, item: item.title, description },
  })
}

// ---------------------------------------------------------------------------
// Revision
// ---------------------------------------------------------------------------

/**
 * Ny revision av en kontroll (rättelse efter godkännande eller ändrade krav).
 * Den tidigare raden och dess svar, bilder och ögonblicksbild lämnas orörda;
 * den nya revisionen får kopior av punkter, svar och bekräftade bilder
 * (samma lagringsobjekt). Ej verifierade avvikelser flyttas med.
 * `sections` (valfritt) = projektanpassade frågor för den nya revisionen.
 */
export async function createRevision(
  db: InspectionDb,
  actor: InspectionActor,
  id: unknown,
  input: { reason?: unknown; sections?: unknown; lock_version?: unknown }
): Promise<number> {
  requireInspectionReviewer(actor)
  const reason = inspText(input.reason, 'Orsak till revisionen', 1000, true)!
  const newSections = input.sections !== undefined ? sectionsOrThrow(input.sections) : null
  return db.tx(async (q) => {
    const row = await loadInspectionRow(q, actor, id, { forUpdate: true })
    assertInspectionCurrent(row)
    assertLockVersion(row, input.lock_version)
    const content = await loadInspectionContent(q, actor.orgId, Number(row.id))
    const sections: TemplateSection[] =
      newSections ??
      groupSections(
        content.items.map((it) => ({
          section: it.section_title,
          item: {
            key: it.item_key, title: it.title, instruction: it.instruction, basis: it.basis, basis_url: it.basis_url,
            method: it.method, answer_type: it.answer_type, unit: it.unit, required: it.required,
            min_photos: it.min_photos, comment_required: it.comment_required, critical: it.critical,
            timing_note: it.timing_note,
          },
        }))
      )
    const keys = new Set(sections.flatMap((s) => s.items.map((i) => i.key)))
    const orphan = content.deviations.find(
      (d) => d.status !== 'verified' && !keys.has(content.items.find((i) => i.id === d.item_id)?.item_key ?? '')
    )
    if (orphan) {
      throw new InspectionError(409, `Punkten "${orphan.item_title}" har en avvikelse som inte är verifierad och kan inte tas bort.`)
    }
    const anyAnswers = content.items.some((it) => it.answer && keys.has(it.item_key))
    const status: InspectionStatus = anyAnswers ? 'in_progress' : 'draft'
    const { rows } = await q.query(
      `INSERT INTO inspections (org_id, project_id, template_id, template_version_id, template_version, name, kind, description,
         location, due_date, responsible_user_id, responsible_name, status, revision, previous_inspection_id, revision_reason,
         started_at, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [
        actor.orgId, row.project_id, row.template_id, row.template_version_id, row.template_version, row.name, row.kind,
        row.description, row.location, row.due_date, row.responsible_user_id, row.responsible_name, status,
        Number(row.revision) + 1, row.id, reason, anyAnswers ? new Date().toISOString() : null, actor.userId,
      ]
    )
    const newId = Number(rows[0].id)
    const inserted = await insertItems(q, actor.orgId, newId, sections)
    const newItemByKey = new Map(inserted.map((i) => [i.key, i.id]))
    const oldByKey = new Map(content.items.map((i) => [i.item_key, i]))
    for (const [key, newItemId] of newItemByKey) {
      const old = oldByKey.get(key)
      if (!old) continue
      if (old.answer) {
        await q.query(
          `INSERT INTO inspection_answers (item_id, org_id, inspection_id, result, checked, text_value, number_value, date_value,
             comment, na_reason, answered_by_user_id, answered_by_name, answered_at, rev)
           SELECT $1, org_id, $2, result, checked, text_value, number_value, date_value, comment, na_reason,
                  answered_by_user_id, answered_by_name, answered_at, 1
           FROM inspection_answers WHERE item_id = $3`,
          [newItemId, newId, old.id]
        )
      }
      await q.query(
        `INSERT INTO inspection_attachments (id, org_id, project_id, inspection_id, item_id, storage_key, content_type, byte_size,
           width, height, exif_orientation, status, uploaded_by_user_id, uploaded_by_name, created_at, confirmed_at)
         SELECT gen_random_uuid(), org_id, project_id, $1, $2, storage_key, content_type, byte_size, width, height,
                exif_orientation, 'confirmed', uploaded_by_user_id, uploaded_by_name, created_at, confirmed_at
         FROM inspection_attachments WHERE item_id = $3 AND status = 'confirmed'`,
        [newId, newItemId, old.id]
      )
      // Ej verifierade avvikelser följer med till den nya revisionen.
      await q.query(
        `UPDATE inspection_attachments SET inspection_id = $1
         WHERE deviation_id IN (SELECT id FROM inspection_deviations WHERE item_id = $2 AND status <> 'verified')`,
        [newId, old.id]
      )
      await q.query(
        "UPDATE inspection_deviations SET inspection_id = $1, item_id = $2, updated_at = now() WHERE item_id = $3 AND status <> 'verified'",
        [newId, newItemId, old.id]
      )
    }
    const oldStatus = row.status as InspectionStatus
    const keepStatus = oldStatus === 'approved' ? 'approved' : 'archived'
    await q.query(
      'UPDATE inspections SET superseded_by_id = $1, status = $2, lock_version = lock_version + 1, updated_at = now() WHERE id = $3',
      [newId, keepStatus, row.id]
    )
    await inspectionEvent(q, actor, Number(row.id), { type: 'superseded', from: oldStatus, to: keepStatus, comment: reason })
    await inspectionEvent(q, actor, newId, { type: 'revision_created', to: status, comment: reason })
    await inspectionActivity(q, actor, {
      entityType: 'inspection',
      entityId: newId,
      projectId: row.project_id,
      eventType: 'inspection.revised',
      metadata: { name: row.name, location: row.location, revision: Number(row.revision) + 1, reason, previous_id: Number(row.id) },
    })
    return newId
  })
}

function groupSections(entries: { section: string; item: TemplateItem }[]): TemplateSection[] {
  const out: TemplateSection[] = []
  for (const e of entries) {
    const last = out[out.length - 1]
    if (last && last.title === e.section) last.items.push(e.item)
    else out.push({ title: e.section, items: [e.item] })
  }
  return out
}
