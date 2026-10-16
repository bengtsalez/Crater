// Egenkontroller & checklistor – delad logik för klient och server.
//
// Ren TypeScript utan beroenden: statusar, etiketter, validering av
// mallinnehåll och kravutvärdering per punkt. Servern är auktoritativ – samma
// funktioner körs där vid inlämning/godkännande, klienten använder dem bara
// för att visa vad som saknas. Se docs/inspections.md.

export const INSPECTION_KINDS = ['checklist', 'self_inspection'] as const
export type InspectionKind = (typeof INSPECTION_KINDS)[number]
export const INSPECTION_KIND_LABELS: Record<InspectionKind, string> = {
  checklist: 'Checklista',
  self_inspection: 'Egenkontroll',
}

export const INSPECTION_STATUSES = ['draft', 'in_progress', 'submitted', 'changes_requested', 'approved', 'archived'] as const
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number]
export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  draft: 'Utkast',
  in_progress: 'Pågår',
  submitted: 'Väntar på granskning',
  changes_requested: 'Komplettering krävs',
  approved: 'Godkänd',
  archived: 'Arkiverad',
}

/** Statusar där svar får sparas (av utförare eller granskare). */
export const ANSWERABLE_STATUSES: readonly InspectionStatus[] = ['draft', 'in_progress', 'changes_requested']
export function isAnswerable(status: InspectionStatus): boolean {
  return ANSWERABLE_STATUSES.includes(status)
}

export type InspectionAction = 'submit' | 'request_changes' | 'approve' | 'archive'
/** Tillåtna övergångar. `start` (draft → in_progress) sker automatiskt vid första svaret. */
export const INSPECTION_TRANSITIONS: Record<InspectionAction, { from: readonly InspectionStatus[]; to: InspectionStatus }> = {
  submit: { from: ['draft', 'in_progress', 'changes_requested'], to: 'submitted' },
  request_changes: { from: ['submitted'], to: 'changes_requested' },
  approve: { from: ['submitted'], to: 'approved' },
  archive: { from: ['draft', 'in_progress', 'submitted', 'changes_requested', 'approved'], to: 'archived' },
}
export const INSPECTION_ACTION_LABELS: Record<InspectionAction, string> = {
  submit: 'Lämna in',
  request_changes: 'Begär komplettering',
  approve: 'Godkänn',
  archive: 'Arkivera',
}

export const ANSWER_TYPES = ['result', 'checkbox', 'text', 'number', 'date'] as const
export type AnswerType = (typeof ANSWER_TYPES)[number]
export const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  result: 'Kontrollresultat',
  checkbox: 'Kryssruta',
  text: 'Fritext',
  number: 'Tal med enhet',
  date: 'Datum',
}

export const RESULT_VALUES = ['ok', 'deviation', 'na'] as const
export type ResultValue = (typeof RESULT_VALUES)[number]
export const RESULT_LABELS: Record<ResultValue, string> = {
  ok: 'Godkänd',
  deviation: 'Avvikelse',
  na: 'Ej tillämplig',
}

export const DEVIATION_STATUSES = ['open', 'resolved', 'verified'] as const
export type DeviationStatus = (typeof DEVIATION_STATUSES)[number]
export const DEVIATION_STATUS_LABELS: Record<DeviationStatus, string> = {
  open: 'Öppen',
  resolved: 'Åtgärdad',
  verified: 'Verifierad',
}

// ---- Bildgränser (servern validerar, klienten visar) ----
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ImageType = (typeof IMAGE_TYPES)[number]
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_IMAGES_PER_TARGET = 20
export const MAX_MIN_PHOTOS = 20

// ---------------------------------------------------------------------------
// Mallinnehåll
// ---------------------------------------------------------------------------

export interface TemplateItem {
  key: string
  title: string
  instruction: string | null
  basis: string | null
  basis_url: string | null
  method: string | null
  answer_type: AnswerType
  unit: string | null
  required: boolean
  min_photos: number
  comment_required: boolean
  critical: boolean
  timing_note: string | null
}

export interface TemplateSection {
  title: string
  items: TemplateItem[]
}

export interface TemplateContent {
  name: string
  kind: InspectionKind
  description: string | null
  department: string | null
  sections: TemplateSection[]
}

export class InspectionValidationError extends Error {}

const MAX_SECTIONS = 50
const MAX_ITEMS = 300

function str(v: unknown, label: string, max: number, required = false): string | null {
  if (v === null || v === undefined) {
    if (required) throw new InspectionValidationError(`${label} krävs.`)
    return null
  }
  if (typeof v !== 'string') throw new InspectionValidationError(`Ogiltigt värde för ${label.toLowerCase()}.`)
  const t = v.trim()
  if (!t) {
    if (required) throw new InspectionValidationError(`${label} krävs.`)
    return null
  }
  if (t.length > max) throw new InspectionValidationError(`${label} får vara högst ${max} tecken.`)
  return t
}

/** Länk till kontrollunderlag: bara http(s). Hämtas aldrig av servern. */
export function normalizeBasisUrl(v: unknown): string | null {
  const s = str(v, 'Länk till underlag', 1000)
  if (!s) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    throw new InspectionValidationError('Länken till underlaget är ogiltig (ange en fullständig adress med https://).')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new InspectionValidationError('Länken till underlaget måste börja med http:// eller https://.')
  }
  return u.toString()
}

const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/

export function newItemKey(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeItem(raw: unknown, usedKeys: Set<string>): TemplateItem {
  const r = (raw ?? {}) as Record<string, unknown>
  const answerType = r.answer_type ?? 'result'
  if (!(ANSWER_TYPES as readonly unknown[]).includes(answerType)) {
    throw new InspectionValidationError('Ogiltig svarstyp.')
  }
  let key = typeof r.key === 'string' && KEY_RE.test(r.key) ? r.key : newItemKey()
  if (usedKeys.has(key)) key = newItemKey()
  usedKeys.add(key)
  const minPhotos = r.min_photos === undefined || r.min_photos === null || r.min_photos === '' ? 0 : Number(r.min_photos)
  if (!Number.isInteger(minPhotos) || minPhotos < 0 || minPhotos > MAX_MIN_PHOTOS) {
    throw new InspectionValidationError(`Minsta antal bilder måste vara 0–${MAX_MIN_PHOTOS}.`)
  }
  return {
    key,
    title: str(r.title, 'Rubrik på kontrollpunkt', 300, true)!,
    instruction: str(r.instruction, 'Instruktion', 4000),
    basis: str(r.basis, 'Kontrollunderlag', 1000),
    basis_url: normalizeBasisUrl(r.basis_url),
    method: str(r.method, 'Kontrollmetod', 500),
    answer_type: answerType as AnswerType,
    unit: answerType === 'number' ? str(r.unit, 'Enhet', 30) : null,
    required: r.required === undefined ? true : !!r.required,
    min_photos: minPhotos,
    comment_required: !!r.comment_required,
    critical: !!r.critical,
    timing_note: str(r.timing_note, 'När kontrollen ska utföras', 500),
  }
}

export function validateSections(raw: unknown): TemplateSection[] {
  if (!Array.isArray(raw)) throw new InspectionValidationError('Ogiltiga avsnitt.')
  if (raw.length > MAX_SECTIONS) throw new InspectionValidationError(`Högst ${MAX_SECTIONS} avsnitt.`)
  const used = new Set<string>()
  let count = 0
  const sections = raw.map((s) => {
    const r = (s ?? {}) as Record<string, unknown>
    if (!Array.isArray(r.items)) throw new InspectionValidationError('Ogiltiga kontrollpunkter.')
    count += r.items.length
    if (count > MAX_ITEMS) throw new InspectionValidationError(`Högst ${MAX_ITEMS} kontrollpunkter.`)
    return {
      title: str(r.title, 'Avsnittets rubrik', 200) ?? '',
      items: r.items.map((it) => normalizeItem(it, used)),
    }
  })
  return sections
}

export function validateTemplateContent(raw: unknown, opts: { requireItems?: boolean } = {}): TemplateContent {
  const r = (raw ?? {}) as Record<string, unknown>
  const kind = r.kind ?? 'self_inspection'
  if (!(INSPECTION_KINDS as readonly unknown[]).includes(kind)) throw new InspectionValidationError('Ogiltig typ.')
  const sections = validateSections(r.sections ?? [])
  if (opts.requireItems && !sections.some((s) => s.items.length)) {
    throw new InspectionValidationError('Mallen måste ha minst en kontrollpunkt för att kunna publiceras.')
  }
  return {
    name: str(r.name, 'Namn', 200, true)!,
    kind: kind as InspectionKind,
    description: str(r.description, 'Beskrivning', 4000),
    department: str(r.department, 'Avdelning', 100),
    sections,
  }
}

// ---------------------------------------------------------------------------
// Kravutvärdering
// ---------------------------------------------------------------------------

export interface ItemRequirements {
  answer_type: AnswerType
  required: boolean
  min_photos: number
  comment_required: boolean
}

export interface AnswerValue {
  result: ResultValue | null
  checked: boolean | null
  text_value: string | null
  number_value: string | null
  date_value: string | null
  comment: string | null
  na_reason: string | null
}

export const EMPTY_ANSWER: AnswerValue = {
  result: null,
  checked: null,
  text_value: null,
  number_value: null,
  date_value: null,
  comment: null,
  na_reason: null,
}

export interface ItemEvaluation {
  /** Punkten har ett svar (Ej tillämplig räknas som svar). */
  answered: boolean
  /** Alla krav för punkten är uppfyllda (eller punkten är frivillig och obesvarad). */
  complete: boolean
  problems: string[]
}

const filled = (s: string | null | undefined) => typeof s === 'string' && s.trim().length > 0

/** Har punkten ett faktiskt svar enligt sin svarstyp? (Obesvarad ≠ godkänd.) */
export function hasValue(item: Pick<ItemRequirements, 'answer_type'>, a: AnswerValue | null): boolean {
  if (!a) return false
  // Ej tillämplig och Avvikelse är bedömningar oavsett svarstyp.
  if (a.result === 'na' || a.result === 'deviation') return true
  switch (item.answer_type) {
    case 'result':
      return a.result === 'ok'
    case 'checkbox':
      return a.checked === true
    case 'text':
      return filled(a.text_value)
    case 'number':
      return filled(a.number_value)
    case 'date':
      return filled(a.date_value)
  }
}

export function evaluateItem(item: ItemRequirements, a: AnswerValue | null, confirmedPhotos: number): ItemEvaluation {
  const problems: string[] = []
  const answered = hasValue(item, a)
  if (!answered) {
    if (item.required) problems.push('Obesvarad')
    // En frivillig punkt kan ändå ha en påbörjad avvikelse utan beskrivning.
    if (a?.result === 'deviation' && !filled(a.comment)) problems.push('Avvikelse kräver beskrivning')
    return { answered, complete: problems.length === 0, problems }
  }
  if (a!.result === 'na') {
    if (!filled(a!.na_reason)) problems.push('Ej tillämplig kräver motivering')
    // Ej tillämplig ersätter punktens foto- och mätkrav.
    return { answered, complete: problems.length === 0, problems }
  }
  if (a!.result === 'deviation' && !filled(a!.comment)) problems.push('Avvikelse kräver beskrivning')
  if (item.comment_required && !filled(a!.comment)) problems.push('Kommentar krävs')
  if (item.min_photos > 0 && confirmedPhotos < item.min_photos) {
    problems.push(`Minst ${item.min_photos} ${item.min_photos === 1 ? 'bild' : 'bilder'} krävs (${confirmedPhotos} uppladdade)`)
  }
  return { answered, complete: problems.length === 0, problems }
}

export interface Coverage {
  required_total: number
  required_answered: number
  total: number
  answered: number
  incomplete: number
}

export function coverage(evals: { required: boolean; evaluation: ItemEvaluation }[]): Coverage {
  const c: Coverage = { required_total: 0, required_answered: 0, total: evals.length, answered: 0, incomplete: 0 }
  for (const e of evals) {
    if (e.required) {
      c.required_total++
      if (e.evaluation.answered) c.required_answered++
    }
    if (e.evaluation.answered) c.answered++
    if (!e.evaluation.complete) c.incomplete++
  }
  return c
}

// ---------------------------------------------------------------------------
// Projektets sammanfattning
// ---------------------------------------------------------------------------

export type ProjectInspectionState =
  | 'none'
  | 'open_deviations'
  | 'changes_requested'
  | 'unanswered'
  | 'submitted'
  | 'approved'

export interface ProjectInspectionSummary {
  state: ProjectInspectionState
  total: number
  unanswered: number
  submitted: number
  changes_requested: number
  approved: number
  open_deviations: number
}

export const PROJECT_INSPECTION_STATE_LABELS: Record<ProjectInspectionState, string> = {
  none: 'Ingen kontroll tillagd',
  open_deviations: 'Öppna avvikelser',
  changes_requested: 'Komplettering krävs',
  unanswered: 'Obesvarade punkter',
  submitted: 'Väntar på granskning',
  approved: 'Alla kontroller godkända',
}

/**
 * `rows` = aktuella (ej ersatta, ej arkiverade) kontroller. Ett projekt utan
 * kontroller får tillståndet 'none' – aldrig "klart".
 */
export function summarizeProjectInspections(
  rows: { status: InspectionStatus; open_deviations: number }[]
): ProjectInspectionSummary {
  const s: ProjectInspectionSummary = {
    state: 'none',
    total: rows.length,
    unanswered: 0,
    submitted: 0,
    changes_requested: 0,
    approved: 0,
    open_deviations: 0,
  }
  for (const r of rows) {
    s.open_deviations += r.open_deviations
    if (r.status === 'approved') s.approved++
    else if (r.status === 'submitted') s.submitted++
    else if (r.status === 'changes_requested') s.changes_requested++
    else s.unanswered++
  }
  if (!s.total) s.state = 'none'
  else if (s.open_deviations) s.state = 'open_deviations'
  else if (s.changes_requested) s.state = 'changes_requested'
  else if (s.unanswered) s.state = 'unanswered'
  else if (s.submitted) s.state = 'submitted'
  else s.state = 'approved'
  return s
}

export function formatAnswerValue(item: { answer_type: AnswerType; unit: string | null }, a: AnswerValue | null): string {
  if (!a) return 'Obesvarad'
  if (a.result === 'na') return RESULT_LABELS.na
  if (a.result === 'deviation' && item.answer_type !== 'result') {
    const v = formatAnswerValue(item, { ...a, result: null })
    return v === 'Obesvarad' ? RESULT_LABELS.deviation : `${v} – ${RESULT_LABELS.deviation}`
  }
  switch (item.answer_type) {
    case 'result':
      return a.result ? RESULT_LABELS[a.result] : 'Obesvarad'
    case 'checkbox':
      return a.checked ? 'Utförd' : 'Obesvarad'
    case 'text':
      return filled(a.text_value) ? a.text_value! : 'Obesvarad'
    case 'number':
      return filled(a.number_value) ? `${a.number_value!.replace('.', ',')}${item.unit ? ` ${item.unit}` : ''}` : 'Obesvarad'
    case 'date':
      return filled(a.date_value) ? a.date_value! : 'Obesvarad'
  }
}
