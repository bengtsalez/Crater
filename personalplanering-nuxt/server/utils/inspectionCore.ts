// Egenkontroller – gemensam kärna: fel, aktör, åtkomstkontroll och vyer.
//
// Filen får INTE röra Nitros auto-imports (createError/apiError/pool …) – den
// testas direkt med vitest mot riktig Postgres (PGlite), se
// test/inspections.db.spec.ts. Fel kastas som InspectionError; routerna
// (server/utils/inspectionHttp.ts) översätter.
//
// Åtkomstregler (se docs/inspections.md):
//  - Allt scopas på org_id från serverns verifierade identitet. Ett id från
//    annan org beter sig som "finns inte" (404).
//  - admin/member (verksamhetsroller) når alla org:ens kontroller.
//  - employee når en kontroll bara om hen är uttryckligen ansvarig för den
//    OCH har en bokning på projektet (samma regel som personalvyn). Annars
//    404 – en tilldelning öppnar aldrig ett annars otillgängligt projekt.
//  - Övriga roller (t.ex. accountant) nekas helt.

import {
  coverage,
  evaluateItem,
  isAnswerable,
  type AnswerValue,
  type InspectionStatus,
  type ResultValue,
} from '../../shared/inspections'
import type {
  AttachmentView,
  DeviationView,
  InspectionEventView,
  InspectionItemView,
  InspectionSnapshot,
  InspectionView,
  SnapshotPhoto,
} from '../../shared/inspectionTypes'
import { logActivity } from './activity'

export class InspectionError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public extra?: Record<string, unknown>
  ) {
    super(message)
  }
}

export type InspQueryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}
export interface InspectionDb extends InspQueryable {
  tx<T>(fn: (q: InspQueryable) => Promise<T>): Promise<T>
}

export type InspectionRole = 'admin' | 'member' | 'employee'

export interface InspectionActor {
  orgId: number
  userId: number
  role: InspectionRole
  name: string
  /** Personalresurs (bara employee) – används för bokningskontrollen. */
  resourceId: number | null
}

export const isInspectionReviewer = (a: InspectionActor) => a.role === 'admin' || a.role === 'member'

export function requireInspectionReviewer(a: InspectionActor) {
  if (!isInspectionReviewer(a)) throw new InspectionError(403, 'Endast projektledare eller administratör kan göra detta.')
}

export function requireTemplateAdmin(a: InspectionActor) {
  if (a.role !== 'admin') throw new InspectionError(403, 'Endast administratör kan hantera företagets mallar.')
}

export const INSPECTION_NOT_FOUND = 'Kontrollen finns inte eller är inte tilldelad dig.'

// ---- Småhjälpare ----

export const inspIso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null)
export const inspNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export function inspText(v: unknown, label: string, max: number, required = false): string | null {
  if (v === null || v === undefined || v === '') {
    if (required) throw new InspectionError(400, `${label} krävs.`)
    return null
  }
  if (typeof v !== 'string') throw new InspectionError(400, `Ogiltigt värde för ${label.toLowerCase()}.`)
  const t = v.trim()
  if (!t) {
    if (required) throw new InspectionError(400, `${label} krävs.`)
    return null
  }
  if (t.length > max) throw new InspectionError(400, `${label} får vara högst ${max} tecken.`)
  return t
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export function inspDate(v: unknown, label: string): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || !ISO_DATE_RE.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) {
    throw new InspectionError(400, `${label} måste vara ett datum (ÅÅÅÅ-MM-DD).`)
  }
  return v
}

export function inspId(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** NUMERIC som text utan avslutande nollor ("12.5000" → "12.5"). */
export function inspTrimNumeric(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

export async function inspectionActivity(
  q: InspQueryable,
  actor: InspectionActor,
  input: { entityType: string; entityId: number; projectId: number; eventType: string; metadata?: Record<string, unknown> }
) {
  await logActivity(q as any, { orgId: actor.orgId, userId: actor.userId, ...input })
}

export async function inspectionEvent(
  q: InspQueryable,
  actor: InspectionActor,
  inspectionId: number,
  e: { type: string; from?: string | null; to?: string | null; comment?: string | null }
) {
  await q.query(
    `INSERT INTO inspection_events (org_id, inspection_id, event_type, from_status, to_status, comment, user_id, user_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actor.orgId, inspectionId, e.type, e.from ?? null, e.to ?? null, e.comment ?? null, actor.userId, actor.name]
  )
}

// ---- Åtkomst ----

export async function employeeHasBooking(q: InspQueryable, actor: InspectionActor, projectId: number): Promise<boolean> {
  if (!actor.resourceId) return false
  const { rows } = await q.query(
    'SELECT 1 FROM assignments WHERE org_id = $1 AND resource_id = $2 AND project_id = $3 LIMIT 1',
    [actor.orgId, actor.resourceId, projectId]
  )
  return rows.length > 0
}

/**
 * Läser kontrollraden om aktören får se den, annars 404. `forUpdate` låser
 * raden (serialiserar sparning, inlämning och godkännande per kontroll).
 */
export async function loadInspectionRow(
  q: InspQueryable,
  actor: InspectionActor,
  id: unknown,
  opts: { forUpdate?: boolean } = {}
): Promise<any> {
  const inspectionId = inspId(id)
  if (!inspectionId) throw new InspectionError(404, INSPECTION_NOT_FOUND)
  const { rows } = await q.query(
    `SELECT * FROM inspections WHERE id = $1 AND org_id = $2${opts.forUpdate ? ' FOR UPDATE' : ''}`,
    [inspectionId, actor.orgId]
  )
  const row = rows[0]
  if (!row) throw new InspectionError(404, INSPECTION_NOT_FOUND)
  if (!isInspectionReviewer(actor)) {
    if (actor.role !== 'employee') throw new InspectionError(404, INSPECTION_NOT_FOUND)
    if (row.responsible_user_id !== actor.userId || row.superseded_by_id !== null) {
      throw new InspectionError(404, INSPECTION_NOT_FOUND)
    }
    if (!(await employeeHasBooking(q, actor, row.project_id))) throw new InspectionError(404, INSPECTION_NOT_FOUND)
  }
  return row
}

export function assertInspectionCurrent(row: any) {
  if (row.superseded_by_id !== null) {
    throw new InspectionError(409, 'Kontrollen har ersatts av en nyare revision och kan inte ändras.', 'superseded')
  }
}

export function assertInspectionAnswerable(row: any) {
  assertInspectionCurrent(row)
  if (!isAnswerable(row.status)) {
    const msg =
      row.status === 'submitted'
        ? 'Kontrollen är inlämnad och väntar på granskning – svar kan inte ändras förrän den återlämnats för komplettering.'
        : row.status === 'approved'
          ? 'Kontrollen är godkänd och låst. Skapa en ny revision för rättelser.'
          : 'Kontrollen är arkiverad och skrivskyddad.'
    throw new InspectionError(409, msg, 'locked')
  }
}

/** Projektet i aktörens org (404 annars). */
export async function loadInspectionProject(q: InspQueryable, actor: InspectionActor, projectId: unknown) {
  const id = inspId(projectId)
  if (!id) throw new InspectionError(404, 'Projektet hittades inte.')
  const { rows } = await q.query(
    `SELECT p.id, p.project_number, p.name, p.site_address, p.work_type, COALESCE(c.name, p.client) AS customer_name
     FROM projects p LEFT JOIN customers c ON c.id = p.customer_id AND c.org_id = p.org_id
     WHERE p.id = $1 AND p.org_id = $2`,
    [id, actor.orgId]
  )
  if (!rows[0]) throw new InspectionError(404, 'Projektet hittades inte.')
  return rows[0]
}

/** Ansvarig användare måste vara aktiv i samma org och ha verksamhetsroll. */
export async function resolveResponsible(q: InspQueryable, actor: InspectionActor, userId: unknown) {
  if (userId === null || userId === undefined || userId === '') return null
  const id = inspId(userId)
  if (!id) throw new InspectionError(400, 'Ogiltig ansvarig.')
  const { rows } = await q.query(
    "SELECT id, username FROM users WHERE id = $1 AND org_id = $2 AND active AND role IN ('admin','member','employee')",
    [id, actor.orgId]
  )
  if (!rows[0]) throw new InspectionError(400, 'Ansvarig måste vara en aktiv användare i företaget.')
  return { id: Number(rows[0].id), name: rows[0].username as string }
}

// ---- Läsning och vyer ----

function mapAttachment(r: any): AttachmentView {
  return {
    id: r.id,
    content_type: r.content_type,
    width: inspNum(r.width),
    height: inspNum(r.height),
    uploaded_by_name: r.uploaded_by_name ?? null,
    created_at: inspIso(r.created_at)!,
  }
}

function mapSnapshotPhoto(r: any): SnapshotPhoto {
  return {
    id: r.id,
    storage_key: r.storage_key,
    content_type: r.content_type,
    width: inspNum(r.width),
    height: inspNum(r.height),
    exif_orientation: inspNum(r.exif_orientation),
  }
}

export function mapDeviationRow(r: any, photos: AttachmentView[]): DeviationView {
  return {
    id: Number(r.id),
    inspection_id: Number(r.inspection_id),
    item_id: Number(r.item_id),
    item_title: r.item_title ?? '',
    project_id: Number(r.project_id),
    description: r.description,
    responsible_user_id: r.responsible_user_id ?? null,
    responsible_name: r.responsible_name ?? null,
    due_date: r.due_date ?? null,
    action_description: r.action_description ?? null,
    status: r.status,
    reported_by_name: r.reported_by_name ?? null,
    created_at: inspIso(r.created_at)!,
    resolved_by_name: r.resolved_by_name ?? null,
    resolved_at: inspIso(r.resolved_at),
    verified_by_name: r.verified_by_name ?? null,
    verified_at: inspIso(r.verified_at),
    reopen_reason: r.reopen_reason ?? null,
    task_id: r.task_id ?? null,
    rev: Number(r.rev),
    photos,
  }
}

interface LoadedContent {
  items: (InspectionItemView & { snapshotPhotos: SnapshotPhoto[] })[]
  deviations: (DeviationView & { snapshotPhotos: SnapshotPhoto[] })[]
  attachmentCount: number
  answerCount: number
}

// Sekventiella frågor: på en transaktions-conn får frågor inte köras parallellt.
export async function loadInspectionContent(q: InspQueryable, orgId: number, inspectionId: number): Promise<LoadedContent> {
  const { rows: itemRows } = await q.query(
    `SELECT i.*, a.item_id AS a_item_id, a.result, a.checked, a.text_value, a.number_value::text AS number_value,
            a.date_value, a.comment, a.na_reason, a.answered_by_name, a.answered_at, a.rev AS a_rev
     FROM inspection_items i
     LEFT JOIN inspection_answers a ON a.item_id = i.id
     WHERE i.inspection_id = $1 AND i.org_id = $2
     ORDER BY i.sort_order, i.id`,
    [inspectionId, orgId]
  )
  const { rows: attRows } = await q.query(
    `SELECT id, item_id, deviation_id, storage_key, content_type, width, height, exif_orientation, uploaded_by_name, created_at
     FROM inspection_attachments
     WHERE inspection_id = $1 AND org_id = $2 AND status = 'confirmed'
     ORDER BY created_at, id`,
    [inspectionId, orgId]
  )
  const { rows: devRows } = await q.query(
    `SELECT d.*, i.title AS item_title FROM inspection_deviations d
     JOIN inspection_items i ON i.id = d.item_id
     WHERE d.inspection_id = $1 AND d.org_id = $2
     ORDER BY d.id`,
    [inspectionId, orgId]
  )
  const byItem = new Map<number, any[]>()
  const byDev = new Map<number, any[]>()
  for (const a of attRows) {
    const map = a.item_id ? byItem : byDev
    const k = Number(a.item_id ?? a.deviation_id)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(a)
  }
  let answerCount = 0
  const items = itemRows.map((r) => {
    const answer: AnswerValue | null = r.a_item_id
      ? {
          result: (r.result ?? null) as ResultValue | null,
          checked: r.checked ?? null,
          text_value: r.text_value ?? null,
          number_value: inspTrimNumeric(r.number_value),
          date_value: r.date_value ?? null,
          comment: r.comment ?? null,
          na_reason: r.na_reason ?? null,
        }
      : null
    if (answer) answerCount++
    const photos = byItem.get(Number(r.id)) ?? []
    return {
      id: Number(r.id),
      item_key: r.item_key,
      section_title: r.section_title ?? '',
      sort_order: Number(r.sort_order),
      title: r.title,
      instruction: r.instruction ?? null,
      basis: r.basis ?? null,
      basis_url: r.basis_url ?? null,
      method: r.method ?? null,
      answer_type: r.answer_type,
      unit: r.unit ?? null,
      required: !!r.required,
      min_photos: Number(r.min_photos),
      comment_required: !!r.comment_required,
      critical: !!r.critical,
      timing_note: r.timing_note ?? null,
      answer: answer
        ? { ...answer, answered_by_name: r.answered_by_name ?? null, answered_at: inspIso(r.answered_at)!, rev: Number(r.a_rev) }
        : null,
      rev: answer ? Number(r.a_rev) : 0,
      photos: photos.map(mapAttachment),
      snapshotPhotos: photos.map(mapSnapshotPhoto),
      evaluation: evaluateItem(
        { answer_type: r.answer_type, required: !!r.required, min_photos: Number(r.min_photos), comment_required: !!r.comment_required },
        answer,
        photos.length
      ),
    }
  })
  const deviations = devRows.map((r) => {
    const photos = byDev.get(Number(r.id)) ?? []
    return { ...mapDeviationRow(r, photos.map(mapAttachment)), snapshotPhotos: photos.map(mapSnapshotPhoto) }
  })
  return { items, deviations, attachmentCount: attRows.length, answerCount }
}

export const openDeviationCount = (devs: { status: string }[]) => devs.filter((d) => d.status !== 'verified').length

async function loadEvents(q: InspQueryable, orgId: number, inspectionId: number): Promise<InspectionEventView[]> {
  const { rows } = await q.query(
    `SELECT id, event_type, from_status, to_status, comment, user_name, created_at
     FROM inspection_events WHERE inspection_id = $1 AND org_id = $2 ORDER BY id`,
    [inspectionId, orgId]
  )
  return rows.map((r) => ({
    id: Number(r.id),
    event_type: r.event_type,
    from_status: r.from_status ?? null,
    to_status: r.to_status ?? null,
    comment: r.comment ?? null,
    user_name: r.user_name ?? null,
    created_at: inspIso(r.created_at)!,
  }))
}

/** Hela revisionskedjan (äldst först) – går bakåt och framåt från raden. */
async function loadRevisionChain(q: InspQueryable, orgId: number, row: any) {
  const { rows } = await q.query(
    `WITH RECURSIVE back AS (
       SELECT id, previous_inspection_id FROM inspections WHERE id = $1 AND org_id = $2
       UNION ALL
       SELECT i.id, i.previous_inspection_id FROM inspections i JOIN back b ON i.id = b.previous_inspection_id
     ), root AS (SELECT id FROM back WHERE previous_inspection_id IS NULL),
     fwd AS (
       SELECT id, superseded_by_id FROM inspections WHERE id = (SELECT id FROM root)
       UNION ALL
       SELECT i.id, i.superseded_by_id FROM inspections i JOIN fwd f ON i.id = f.superseded_by_id
     )
     SELECT i.id, i.revision, i.status, i.approved_at FROM inspections i
     WHERE i.id IN (SELECT id FROM fwd) AND i.org_id = $2 ORDER BY i.revision`,
    [row.id, orgId]
  )
  return rows.map((r) => ({
    id: Number(r.id),
    revision: Number(r.revision),
    status: r.status as InspectionStatus,
    approved_at: inspIso(r.approved_at),
  }))
}

function baseFields(row: any) {
  return {
    id: Number(row.id),
    name: row.name,
    kind: row.kind,
    description: row.description ?? null,
    location: row.location ?? null,
    due_date: row.due_date ?? null,
    responsible_user_id: row.responsible_user_id ?? null,
    responsible_name: row.responsible_name ?? null,
    status: row.status as InspectionStatus,
    revision: Number(row.revision),
    previous_inspection_id: inspNum(row.previous_inspection_id),
    superseded_by_id: inspNum(row.superseded_by_id),
    revision_reason: row.revision_reason ?? null,
    lock_version: Number(row.lock_version),
    template_id: inspNum(row.template_id),
    template_version: Number(row.template_version),
    started_at: inspIso(row.started_at),
    submitted_at: inspIso(row.submitted_at),
    submitted_by_name: row.submitted_by_name ?? null,
    review_comment: row.review_comment ?? null,
    approved_at: inspIso(row.approved_at),
    approved_by_name: row.approved_by_name ?? null,
    approval_comment: row.approval_comment ?? null,
  }
}

function projectFields(p: any): InspectionView['project'] {
  return {
    id: Number(p.id),
    project_number: p.project_number,
    name: p.name,
    site_address: p.site_address ?? null,
    customer_name: p.customer_name ?? null,
    work_type: p.work_type ?? 'project',
  }
}

export async function buildInspectionView(
  q: InspQueryable,
  actor: InspectionActor,
  row: any,
  storageConfigured: boolean
): Promise<InspectionView> {
  const project = await loadInspectionProject(q, actor, row.project_id)
  const content = await loadInspectionContent(q, actor.orgId, Number(row.id))
  const events = await loadEvents(q, actor.orgId, Number(row.id))
  const revisions = isInspectionReviewer(actor)
    ? await loadRevisionChain(q, actor.orgId, row)
    : [{ id: Number(row.id), revision: Number(row.revision), status: row.status, approved_at: inspIso(row.approved_at) }]
  const reviewer = isInspectionReviewer(actor)
  const current = row.superseded_by_id === null
  const answerable = current && isAnswerable(row.status)
  const responsible = row.responsible_user_id === actor.userId
  const strip = <T extends { snapshotPhotos: unknown }>({ snapshotPhotos: _s, ...rest }: T) => rest
  return {
    ...baseFields(row),
    project: projectFields(project),
    items: content.items.map(strip),
    deviations: content.deviations.map(strip),
    coverage: coverage(content.items),
    open_deviations: openDeviationCount(content.deviations),
    events,
    revisions,
    storage_configured: storageConfigured,
    can: {
      answer: answerable && (reviewer || responsible),
      submit: answerable && (reviewer || responsible),
      review: reviewer && current && row.status === 'submitted',
      manage: reviewer,
      edit_items:
        reviewer && current && row.status === 'draft' && content.answerCount === 0 && content.attachmentCount === 0,
      revise: reviewer && current && (row.status !== 'draft' || content.answerCount > 0 || content.attachmentCount > 0),
    },
  }
}

/** Fullständig ögonblicksbild av kontrollens innehåll (låses vid godkännande). */
export async function buildInspectionSnapshot(q: InspQueryable, actor: InspectionActor, row: any): Promise<InspectionSnapshot> {
  const project = await loadInspectionProject(q, actor, row.project_id)
  const org = (await q.query('SELECT name FROM organizations WHERE id = $1', [actor.orgId])).rows[0]
  const tv = (
    await q.query('SELECT name FROM inspection_template_versions WHERE id = $1 AND org_id = $2', [row.template_version_id, actor.orgId])
  ).rows[0]
  const content = await loadInspectionContent(q, actor.orgId, Number(row.id))
  const events = await loadEvents(q, actor.orgId, Number(row.id))
  return {
    schema: 1,
    org: { name: org?.name ?? '' },
    project: projectFields(project),
    inspection: { ...baseFields(row), template_name: tv?.name ?? null },
    items: content.items.map(({ snapshotPhotos, photos: _p, rev: _r, ...it }) => ({ ...it, photos: snapshotPhotos })),
    deviations: content.deviations.map(({ snapshotPhotos, photos: _p, ...d }) => ({ ...d, photos: snapshotPhotos })),
    events,
    coverage: coverage(content.items),
    generated_at: new Date().toISOString(),
  }
}
