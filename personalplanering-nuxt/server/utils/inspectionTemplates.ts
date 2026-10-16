// Egenkontroller – företagets mallbibliotek med versionshantering.
//
// Nitro-fri (testas med PGlite). Regler:
//  - Bara admin skapar, redigerar, publicerar, duplicerar och arkiverar.
//    member läser aktiva mallar (för att lägga till kontroller på projekt).
//  - Utkastet (draft_content) är det enda som ändras. Publicering skapar en
//    ny oföränderlig rad i inspection_template_versions.
//  - draft_rev skyddar mot att ett äldre formulär skriver över ett nyare utkast.
//  - Arkivering tar bort mallen från nya val men påverkar inga kontroller.

import {
  InspectionValidationError,
  validateTemplateContent,
  type TemplateContent,
} from '../../shared/inspections'
import { EXAMPLE_TEMPLATES } from '../../shared/inspectionExamples'
import type { InspectionTemplateDetail, InspectionTemplateSummary } from '../../shared/inspectionTypes'
import {
  InspectionError,
  inspId,
  inspIso,
  isInspectionReviewer,
  requireTemplateAdmin,
  type InspectionActor,
  type InspectionDb,
  type InspQueryable,
} from './inspectionCore'

const TEMPLATE_NOT_FOUND = 'Mallen hittades inte.'

function validated(raw: unknown, requireItems = false): TemplateContent {
  try {
    return validateTemplateContent(raw, { requireItems })
  } catch (err) {
    if (err instanceof InspectionValidationError) throw new InspectionError(400, err.message)
    throw err
  }
}

const countItems = (c: TemplateContent | null) => (c ? c.sections.reduce((n, s) => n + s.items.length, 0) : 0)

function mapSummary(r: any, published: TemplateContent | null): InspectionTemplateSummary {
  return {
    id: Number(r.id),
    name: r.name,
    kind: r.kind,
    description: r.description ?? null,
    department: r.department ?? null,
    status: r.status,
    latest_version: Number(r.latest_version),
    has_draft: r.draft_content !== null && r.draft_content !== undefined,
    is_example: !!r.example_key,
    item_count: countItems(published ?? r.draft_content ?? null),
    updated_at: inspIso(r.updated_at)!,
  }
}

function contentOfVersion(v: any): TemplateContent | null {
  if (!v) return null
  return {
    name: v.name,
    kind: v.kind,
    description: v.description ?? null,
    department: v.content?.department ?? null,
    sections: v.content?.sections ?? [],
  }
}

export async function listTemplates(
  q: InspQueryable,
  actor: InspectionActor,
  opts: { includeArchived?: boolean } = {}
): Promise<InspectionTemplateSummary[]> {
  if (!isInspectionReviewer(actor)) throw new InspectionError(403, 'Saknar behörighet.')
  const admin = actor.role === 'admin'
  const { rows } = await q.query(
    `SELECT t.*, v.name AS v_name, v.kind AS v_kind, v.description AS v_description, v.content AS v_content
     FROM inspection_templates t
     LEFT JOIN inspection_template_versions v ON v.template_id = t.id AND v.version = t.latest_version
     WHERE t.org_id = $1 AND ($2::boolean OR t.status = 'active') AND ($3::boolean OR t.latest_version > 0)
     ORDER BY t.status, lower(t.name), t.id`,
    [actor.orgId, admin && !!opts.includeArchived, admin]
  )
  return rows.map((r) =>
    mapSummary(r, r.v_content ? contentOfVersion({ name: r.v_name, kind: r.v_kind, description: r.v_description, content: r.v_content }) : null)
  )
}

async function loadTemplateRow(q: InspQueryable, actor: InspectionActor, id: unknown, forUpdate = false) {
  const tid = inspId(id)
  if (!tid) throw new InspectionError(404, TEMPLATE_NOT_FOUND)
  const { rows } = await q.query(
    `SELECT * FROM inspection_templates WHERE id = $1 AND org_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [tid, actor.orgId]
  )
  if (!rows[0]) throw new InspectionError(404, TEMPLATE_NOT_FOUND)
  return rows[0]
}

export async function getTemplate(q: InspQueryable, actor: InspectionActor, id: unknown): Promise<InspectionTemplateDetail> {
  if (!isInspectionReviewer(actor)) throw new InspectionError(403, 'Saknar behörighet.')
  const t = await loadTemplateRow(q, actor, id)
  if (actor.role !== 'admin' && (t.status !== 'active' || Number(t.latest_version) === 0)) {
    throw new InspectionError(404, TEMPLATE_NOT_FOUND)
  }
  const { rows: versions } = await q.query(
    `SELECT version, name, kind, description, content, published_at, published_by_name
     FROM inspection_template_versions WHERE template_id = $1 AND org_id = $2 ORDER BY version DESC`,
    [t.id, actor.orgId]
  )
  const published = contentOfVersion(versions[0])
  return {
    ...mapSummary(t, published),
    draft: actor.role === 'admin' ? (t.draft_content ?? null) : null,
    draft_rev: Number(t.draft_rev),
    published,
    versions: versions.map((v) => ({
      version: Number(v.version),
      published_at: inspIso(v.published_at)!,
      published_by_name: v.published_by_name ?? null,
    })),
  }
}

export async function createTemplate(db: InspectionDb, actor: InspectionActor, raw: unknown) {
  requireTemplateAdmin(actor)
  const content = validated(raw)
  const { rows } = await db.query(
    `INSERT INTO inspection_templates (org_id, name, kind, description, department, draft_content, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [actor.orgId, content.name, content.kind, content.description, content.department, JSON.stringify(content), actor.userId]
  )
  return getTemplate(db, actor, rows[0].id)
}

function assertRev(t: any, expected: unknown) {
  if (Number(expected) !== Number(t.draft_rev)) {
    throw new InspectionError(
      409,
      'Mallen har ändrats av någon annan sedan du öppnade den. Ladda om för att se den senaste versionen.',
      'conflict'
    )
  }
}

export async function saveTemplateDraft(db: InspectionDb, actor: InspectionActor, id: unknown, raw: unknown, expectedRev: unknown) {
  requireTemplateAdmin(actor)
  const content = validated(raw)
  await db.tx(async (q) => {
    const t = await loadTemplateRow(q, actor, id, true)
    if (t.status === 'archived') throw new InspectionError(409, 'Mallen är arkiverad. Återställ den för att redigera.')
    assertRev(t, expectedRev)
    await q.query(
      `UPDATE inspection_templates SET draft_content = $1, draft_rev = draft_rev + 1, updated_at = now()
       WHERE id = $2 AND org_id = $3`,
      [JSON.stringify(content), t.id, actor.orgId]
    )
    // Opublicerad mall: namn/typ i listan följer utkastet.
    if (Number(t.latest_version) === 0) {
      await q.query(
        'UPDATE inspection_templates SET name = $1, kind = $2, description = $3, department = $4 WHERE id = $5',
        [content.name, content.kind, content.description, content.department, t.id]
      )
    }
  })
  return getTemplate(db, actor, id)
}

export async function discardTemplateDraft(db: InspectionDb, actor: InspectionActor, id: unknown, expectedRev: unknown) {
  requireTemplateAdmin(actor)
  await db.tx(async (q) => {
    const t = await loadTemplateRow(q, actor, id, true)
    assertRev(t, expectedRev)
    if (Number(t.latest_version) === 0) throw new InspectionError(409, 'Mallen har ingen publicerad version att återgå till.')
    await q.query('UPDATE inspection_templates SET draft_content = NULL, draft_rev = draft_rev + 1, updated_at = now() WHERE id = $1', [t.id])
  })
  return getTemplate(db, actor, id)
}

export async function publishTemplate(db: InspectionDb, actor: InspectionActor, id: unknown, expectedRev: unknown) {
  requireTemplateAdmin(actor)
  await db.tx(async (q) => {
    const t = await loadTemplateRow(q, actor, id, true)
    if (t.status === 'archived') throw new InspectionError(409, 'Mallen är arkiverad.')
    assertRev(t, expectedRev)
    if (!t.draft_content) throw new InspectionError(409, 'Det finns inget utkast att publicera.')
    const content = validated(t.draft_content, true)
    const version = Number(t.latest_version) + 1
    await insertVersion(q, actor, Number(t.id), version, content)
    await q.query(
      `UPDATE inspection_templates
       SET name = $1, kind = $2, description = $3, department = $4, latest_version = $5,
           draft_content = NULL, draft_rev = draft_rev + 1, updated_at = now()
       WHERE id = $6`,
      [content.name, content.kind, content.description, content.department, version, t.id]
    )
  })
  return getTemplate(db, actor, id)
}

async function insertVersion(q: InspQueryable, actor: InspectionActor, templateId: number, version: number, c: TemplateContent) {
  await q.query(
    `INSERT INTO inspection_template_versions
       (org_id, template_id, version, name, kind, description, content, published_by_user_id, published_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      actor.orgId,
      templateId,
      version,
      c.name,
      c.kind,
      c.description,
      JSON.stringify({ department: c.department, sections: c.sections }),
      actor.userId,
      actor.name,
    ]
  )
}

export async function duplicateTemplate(db: InspectionDb, actor: InspectionActor, id: unknown) {
  requireTemplateAdmin(actor)
  const src = await getTemplate(db, actor, id)
  const base = src.draft ?? src.published
  if (!base) throw new InspectionError(409, 'Mallen saknar innehåll.')
  return createTemplate(db, actor, { ...base, name: `Kopia av ${base.name}`.slice(0, 200) })
}

export async function setTemplateArchived(db: InspectionDb, actor: InspectionActor, id: unknown, archived: boolean) {
  requireTemplateAdmin(actor)
  const t = await loadTemplateRow(db, actor, id)
  await db.query('UPDATE inspection_templates SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3', [
    archived ? 'archived' : 'active',
    t.id,
    actor.orgId,
  ])
  return getTemplate(db, actor, id)
}

/**
 * Lägger till exempelmallarna som publicerad version 1. Idempotent per org via
 * unikt (org_id, example_key) – en redan tillagd (även redigerad eller
 * arkiverad) exempelmall läggs aldrig till igen. Rör inga projekt.
 */
export async function importExampleTemplates(db: InspectionDb, actor: InspectionActor) {
  requireTemplateAdmin(actor)
  let added = 0
  await db.tx(async (q) => {
    for (const ex of EXAMPLE_TEMPLATES) {
      const content = validated({ ...ex, department: null }, true)
      const { rows } = await q.query(
        `INSERT INTO inspection_templates (org_id, name, kind, description, latest_version, example_key, created_by_user_id)
         VALUES ($1,$2,$3,$4,1,$5,$6)
         ON CONFLICT (org_id, example_key) WHERE example_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [actor.orgId, content.name, content.kind, content.description, ex.example_key, actor.userId]
      )
      if (!rows[0]) continue
      await insertVersion(q, actor, Number(rows[0].id), 1, content)
      added++
    }
  })
  return { added, skipped: EXAMPLE_TEMPLATES.length - added }
}

/** Senaste publicerade version av en aktiv mall (för att skapa kontroller). */
export async function latestPublishedVersion(q: InspQueryable, actor: InspectionActor, templateId: unknown) {
  const tid = inspId(templateId)
  if (!tid) throw new InspectionError(400, 'Ogiltig mall.')
  const { rows } = await q.query(
    `SELECT v.* FROM inspection_templates t
     JOIN inspection_template_versions v ON v.template_id = t.id AND v.version = t.latest_version
     WHERE t.id = $1 AND t.org_id = $2 AND t.status = 'active'`,
    [tid, actor.orgId]
  )
  if (!rows[0]) throw new InspectionError(400, 'Mallen finns inte, är arkiverad eller saknar publicerad version.')
  return rows[0]
}
