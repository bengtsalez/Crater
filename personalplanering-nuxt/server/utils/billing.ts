// Fakturering – dataåtkomst och affärsregler för faktureringsunderlag.
//
// Filen får INTE röra Nitros auto-imports (createError/apiError/pool …) – den
// testas direkt med vitest mot riktig Postgres (PGlite), se test/billing.db.spec.ts.
// Fel kastas som BillingError(status, svensk text); routerna översätter.
//
// Regler i korthet (se docs/billing.md):
//  - Allt scopas på org_id; ett id från annan org beter sig som "finns inte" (404).
//  - Varje mutation sker i en transaktion som först låser projektets
//    project_billing-rad (FOR UPDATE) – serialiserar samtidiga ändringar per projekt.
//  - Fakturerade/betalda delar är låsta: belopp, rader, fördelning, mottagare och
//    ROT ändras aldrig direkt – bara via en separat korrigering. Låsningen sparar
//    `locked_summary` + en oföränderlig billing_documents-version (snapshot).
//  - ROT-belopp fylls aldrig i automatiskt.

import {
  allocatedQuantity,
  computeBilling,
  DEFAULT_ROT_BP,
  isLockedStatus,
  kronorToOre,
  lineExOre,
  lineItems,
  LINE_TYPES,
  maskPersonnummer,
  normalizeDecimal,
  normalizePersonnummer,
  parseScaled,
  partBlockingErrors,
  PRICE_SCALE,
  proposeAllocation,
  QTY_SCALE,
  summarize,
  type AllocationInput,
  type AtaStatus,
  type BillingInput,
  type BillingResult,
  type CalcLine,
  type LineType,
  type LockedSummary,
  type PartInput,
  type PartKind,
  type PartStatus,
  type RotStatus,
} from '../../shared/billing'
import type {
  AtaCandidate,
  AtaInfo,
  BillingLine,
  BillingPart,
  BillingSettings,
  BillingSnapshot,
  ProjectBillingView,
  RotRecipientView,
  SnapshotLine,
} from '../../shared/billingTypes'
import { BillingError, encryptPnr } from './billingCrypto'
import { logActivity } from './activity'

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}
export interface BillingDb extends Queryable {
  /** Kör `fn` i en transaktion (BEGIN/COMMIT, ROLLBACK vid fel). */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
}

export interface BillingCtx {
  orgId: number
  userId: number | null
}

// ---------------------------------------------------------------------------
// Typer för vyn
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Inläsning
// ---------------------------------------------------------------------------

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null)

const LINE_COLS = `id, part_id, sort_order, description, line_type, quantity::text AS quantity, unit,
  unit_price_ex_vat::text AS unit_price_ex_vat, vat_rate_bp, rot_eligible`

function mapLine(r: any): BillingLine {
  return {
    id: Number(r.id),
    part_id: numOrNull(r.part_id),
    sort_order: Number(r.sort_order),
    description: r.description,
    line_type: r.line_type,
    quantity: normalizeDecimal(r.quantity, QTY_SCALE) ?? '0',
    unit: r.unit ?? null,
    unit_price_ex_vat: normalizeDecimal(r.unit_price_ex_vat, PRICE_SCALE) ?? '0',
    vat_rate_bp: Number(r.vat_rate_bp),
    rot_eligible: !!r.rot_eligible,
  }
}

interface RawState {
  project: any
  settings: BillingSettings & { exists: boolean }
  lines: BillingLine[]
  parts: any[]
  recipients: any[]
  allocations: AllocationInput[]
  ataItems: any[]
  documents: any[]
}

async function loadRaw(q: Queryable, orgId: number, projectId: number): Promise<RawState | null> {
  if (!Number.isInteger(projectId) || projectId <= 0) return null
  const proj = (
    await q.query(
      `SELECT id, project_number, name, site_address, customer_id, sum, work_type
       FROM projects WHERE id = $1 AND org_id = $2`,
      [projectId, orgId]
    )
  ).rows[0]
  if (!proj) return null
  const p = [orgId, projectId]
  // Sekventiellt: `q` kan vara en transaktions enda anslutning (pg tillåter inte
  // parallella frågor på samma klient).
  const s = await q.query('SELECT * FROM project_billing WHERE org_id = $1 AND project_id = $2', p)
  const lines = await q.query(`SELECT ${LINE_COLS} FROM billing_lines WHERE org_id = $1 AND project_id = $2 ORDER BY sort_order, id`, p)
  const parts = await q.query('SELECT * FROM billing_parts WHERE org_id = $1 AND project_id = $2 ORDER BY sort_order, id', p)
  const recipients = await q.query(
    `SELECT r.* FROM billing_rot_recipients r JOIN billing_parts bp ON bp.id = r.part_id
     WHERE r.org_id = $1 AND bp.project_id = $2 ORDER BY r.position`,
    p
  )
  const allocations = await q.query(
    `SELECT a.part_id, a.line_id, a.amount_ex_ore FROM billing_allocations a
     JOIN billing_parts bp ON bp.id = a.part_id WHERE a.org_id = $1 AND bp.project_id = $2`,
    p
  )
  const ataItems = await q.query(
    `SELECT id, description, amount, date, ata_status, revision FROM project_line_items
     WHERE org_id = $1 AND project_id = $2 AND type = 'ata' ORDER BY date NULLS LAST, id`,
    p
  )
  const documents = await q.query(
    `SELECT id, part_id, version, created_at FROM billing_documents
     WHERE org_id = $1 AND project_id = $2 ORDER BY part_id, version`,
    p
  )
  const sr = s.rows[0]
  return {
    project: proj,
    settings: {
      exists: !!sr,
      base_total_inc_ore: sr ? numOrNull(sr.base_total_inc_ore) : null,
      rot_enabled: sr ? !!sr.rot_enabled : false,
      rot_rate_bp: sr ? Number(sr.rot_rate_bp) : DEFAULT_ROT_BP,
      property_designation: sr?.property_designation ?? null,
      housing_type: sr?.housing_type ?? null,
      brf_name: sr?.brf_name ?? null,
      brf_org_number: sr?.brf_org_number ?? null,
      apartment_number: sr?.apartment_number ?? null,
    },
    lines: lines.rows.map(mapLine),
    parts: parts.rows,
    recipients: recipients.rows,
    allocations: allocations.rows.map((a) => ({
      part_id: Number(a.part_id),
      line_id: Number(a.line_id),
      amount_ex_ore: Number(a.amount_ex_ore),
    })),
    ataItems: ataItems.rows,
    documents: documents.rows,
  }
}

function buildParts(raw: RawState): BillingPart[] {
  const ataById = new Map(raw.ataItems.map((a) => [Number(a.id), a]))
  const docNoById = new Map(raw.parts.map((p) => [Number(p.id), p.document_number as string]))
  return raw.parts.map((p): BillingPart => {
    const id = Number(p.id)
    const status = p.status as PartStatus
    const locked = isLockedStatus(status)
    const recips = [1, 2].map((pos): RotRecipientView => {
      const r = raw.recipients.find((x) => Number(x.part_id) === id && Number(x.position) === pos)
      return {
        position: pos,
        name: r?.name ?? null,
        personnummer_masked: r?.personnummer_enc ? maskPersonnummer(r.personnummer_last4) : '',
        has_pnr: !!r?.personnummer_enc,
        amount_ore: num(r?.amount_ore),
      }
    })
    let ata: AtaInfo | null = null
    if (p.kind === 'ata') {
      const cur = ataById.get(Number(p.ata_line_item_id))
      const current = cur
        ? {
            description: cur.description,
            amount: Number(cur.amount),
            date: cur.date ?? null,
            ata_status: cur.ata_status as AtaStatus,
            revision: Number(cur.revision),
          }
        : null
      ata = {
        line_item_id: Number(p.ata_line_item_id),
        source: p.ata_source ?? null,
        source_revision: numOrNull(p.ata_source_revision),
        current,
        // Låsta delar påverkas aldrig av senare ändringar i källposten.
        deviation: !locked && !!current && current.revision !== Number(p.ata_source_revision),
      }
    }
    return {
      id,
      kind: p.kind,
      name: p.name,
      sort_order: Number(p.sort_order),
      percent_bp: numOrNull(p.percent_bp),
      planned_date: p.planned_date ?? null,
      milestone: p.milestone ?? null,
      notes: p.notes ?? null,
      document_number: p.document_number,
      rot_rate_bp: Number(p.rot_rate_bp),
      status,
      locked,
      locked_at: iso(p.locked_at),
      invoiced_date: p.invoiced_date ?? null,
      external_invoice_ref: p.external_invoice_ref ?? null,
      customer_paid_ore: num(p.customer_paid_ore),
      customer_paid_date: p.customer_paid_date ?? null,
      rot_status: p.rot_status,
      rot_applied_ore: num(p.rot_applied_ore),
      rot_paid_ore: num(p.rot_paid_ore),
      rot_applied_date: p.rot_applied_date ?? null,
      rot_paid_date: p.rot_paid_date ?? null,
      corrects_part_id: numOrNull(p.corrects_part_id),
      corrects_document_number: p.corrects_part_id ? docNoById.get(Number(p.corrects_part_id)) ?? null : null,
      lines: raw.lines.filter((l) => l.part_id === id),
      rot_recipients: recips,
      ata,
      documents: raw.documents
        .filter((d) => Number(d.part_id) === id)
        .map((d) => ({ id: Number(d.id), version: Number(d.version), created_at: iso(d.created_at)! })),
    }
  })
}

function toInput(raw: RawState, parts: BillingPart[]): BillingInput {
  return {
    base_total_inc_ore: raw.settings.base_total_inc_ore,
    rot_enabled: raw.settings.rot_enabled,
    base_lines: raw.lines.filter((l) => l.part_id === null),
    allocations: raw.allocations,
    parts: parts.map(
      (p): PartInput => ({
        id: p.id,
        kind: p.kind,
        name: p.name,
        sort_order: p.sort_order,
        percent_bp: p.percent_bp,
        status: p.status,
        rot_rate_bp: p.rot_rate_bp,
        lines: p.lines,
        rot_recipients: p.rot_recipients.map((r) => ({
          position: r.position,
          name: r.name,
          has_valid_pnr: r.has_pnr,
          amount_ore: r.amount_ore,
        })),
        locked_summary: (raw.parts.find((x) => Number(x.id) === p.id)?.locked_summary as LockedSummary) ?? null,
        customer_paid_ore: p.customer_paid_ore,
        rot_status: p.rot_status,
        rot_applied_ore: p.rot_applied_ore,
        rot_paid_ore: p.rot_paid_ore,
        ata_deviation: !!p.ata?.deviation,
      })
    ),
  }
}

/** Hela faktureringsvyn för ett projekt, eller null om projektet inte finns i org:en. */
export async function getProjectBilling(q: Queryable, orgId: number, projectId: number): Promise<ProjectBillingView | null> {
  const raw = await loadRaw(q, orgId, projectId)
  if (!raw) return null
  const parts = buildParts(raw)
  const input = toInput(raw, parts)
  const { exists: _exists, ...settings } = raw.settings
  return {
    project: {
      id: Number(raw.project.id),
      project_number: raw.project.project_number,
      name: raw.project.name,
      site_address: raw.project.site_address ?? null,
      customer_id: numOrNull(raw.project.customer_id),
      contract_sum: numOrNull(raw.project.sum),
    },
    settings,
    base_lines: input.base_lines as BillingLine[],
    parts,
    allocations: raw.allocations,
    calc: computeBilling(input),
  }
}

/** Projektets ÄTA för dialogen "Hämta ÄTA": status och om posten redan hämtats/fakturerats. */
export async function listAtaCandidates(q: Queryable, orgId: number, projectId: number): Promise<AtaCandidate[] | null> {
  const { rows: found } = await q.query('SELECT 1 FROM projects WHERE id = $1 AND org_id = $2', [projectId, orgId])
  if (!found.length) return null
  const { rows } = await q.query(
    `SELECT li.id, li.description, li.amount, li.date, li.ata_status,
            bp.id AS part_id, bp.status AS part_status, bp.document_number
     FROM project_line_items li
     LEFT JOIN billing_parts bp ON bp.ata_line_item_id = li.id AND bp.kind = 'ata' AND bp.org_id = li.org_id
     WHERE li.org_id = $1 AND li.project_id = $2 AND li.type = 'ata'
     ORDER BY li.date NULLS LAST, li.id`,
    [orgId, projectId]
  )
  return rows.map((r) => ({
    id: Number(r.id),
    description: r.description,
    amount: Number(r.amount),
    date: r.date ?? null,
    ata_status: r.ata_status,
    part_id: numOrNull(r.part_id),
    part_status: r.part_status ?? null,
    document_number: r.document_number ?? null,
  }))
}

// ---------------------------------------------------------------------------
// Hjälpare för mutationer
// ---------------------------------------------------------------------------

/** Säkerställer project_billing-raden och låser den för transaktionen. 404 om projektet saknas i org:en. */
async function lockProject(q: Queryable, orgId: number, projectId: number) {
  const { rows: found } = await q.query('SELECT 1 FROM projects WHERE id = $1 AND org_id = $2', [projectId, orgId])
  if (!found.length) throw new BillingError(404, 'Hittades inte.')
  await q.query(
    'INSERT INTO project_billing (project_id, org_id) VALUES ($1, $2) ON CONFLICT (project_id) DO NOTHING',
    [projectId, orgId]
  )
  const row = (
    await q.query('SELECT * FROM project_billing WHERE project_id = $1 AND org_id = $2 FOR UPDATE', [projectId, orgId])
  ).rows[0]
  if (!row) throw new BillingError(404, 'Hittades inte.')
  return row
}

/** Projektet som en del tillhör (org-scopat). 404 annars. */
async function partProject(q: Queryable, orgId: number, partId: number): Promise<number> {
  if (!Number.isInteger(partId) || partId <= 0) throw new BillingError(404, 'Hittades inte.')
  const r = (await q.query('SELECT project_id FROM billing_parts WHERE id = $1 AND org_id = $2', [partId, orgId])).rows[0]
  if (!r) throw new BillingError(404, 'Hittades inte.')
  return Number(r.project_id)
}

async function nextDocumentNumber(q: Queryable, orgId: number, projectId: number): Promise<string> {
  const r = (
    await q.query(
      `UPDATE project_billing SET next_doc_seq = next_doc_seq + 1
       WHERE project_id = $1 AND org_id = $2 RETURNING next_doc_seq - 1 AS seq`,
      [projectId, orgId]
    )
  ).rows[0]
  const proj = (await q.query('SELECT project_number FROM projects WHERE id = $1 AND org_id = $2', [projectId, orgId])).rows[0]
  return `FU-${proj.project_number}-${String(r.seq).padStart(2, '0')}`
}

async function createRecipients(q: Queryable, orgId: number, partId: number) {
  await q.query(
    `INSERT INTO billing_rot_recipients (org_id, part_id, position) VALUES ($1, $2, 1), ($1, $2, 2)
     ON CONFLICT (part_id, position) DO NOTHING`,
    [orgId, partId]
  )
}

function text(v: unknown, max = 500): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  if (s.length > max) throw new BillingError(400, `Texten får vara högst ${max} tecken.`)
  return s || null
}

function dateOrNull(v: unknown): string | null {
  const s = text(v, 20)
  if (s === null) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BillingError(400, 'Ogiltigt datum (ÅÅÅÅ-MM-DD).')
  return s
}

function percentToBp(v: unknown, label = 'Procentsats'): number {
  const bp = parseScaled(v as string, 2)
  if (bp === null || bp < 0n || bp > 10000n) throw new BillingError(400, `${label} måste vara mellan 0 och 100 %.`)
  return Number(bp)
}

function oreOrThrow(v: unknown, label: string, { allowNull = false, allowNegative = false } = {}): number | null {
  if ((v === null || v === undefined || v === '') && allowNull) return null
  const ore = kronorToOre(v as string)
  if (ore === null) throw new BillingError(400, `${label}: ogiltigt belopp.`)
  if (!allowNegative && ore < 0) throw new BillingError(400, `${label} får inte vara negativt.`)
  return ore
}

interface LineInput {
  id?: number | null
  description?: unknown
  line_type?: unknown
  quantity?: unknown
  unit?: unknown
  unit_price_ex_vat?: unknown
  vat_rate_bp?: unknown
  rot_eligible?: unknown
}

function parseLine(l: LineInput, idx: number, allowNegative: boolean): Omit<BillingLine, 'id' | 'part_id'> {
  const label = `Rad ${idx + 1}`
  const description = text(l.description, 500)
  if (!description) throw new BillingError(400, `${label}: beskrivning krävs.`)
  const line_type = l.line_type as LineType
  if (!LINE_TYPES.includes(line_type)) throw new BillingError(400, `${label}: ogiltig typ.`)
  const quantity = normalizeDecimal(l.quantity as string, QTY_SCALE)
  if (quantity === null) throw new BillingError(400, `${label}: ogiltigt antal.`)
  const price = normalizeDecimal(l.unit_price_ex_vat as string, PRICE_SCALE)
  if (price === null) throw new BillingError(400, `${label}: ogiltigt à-pris.`)
  if (!allowNegative && (quantity.startsWith('-') || price.startsWith('-'))) {
    throw new BillingError(400, `${label}: antal och pris får inte vara negativa.`)
  }
  if (Math.abs(Number(quantity)) >= 1e11 || Math.abs(Number(price)) >= 1e13) throw new BillingError(400, `${label}: för stort värde.`)
  const vat = l.vat_rate_bp === undefined || l.vat_rate_bp === null ? 2500 : Number(l.vat_rate_bp)
  if (!Number.isInteger(vat) || vat < 0 || vat > 10000) throw new BillingError(400, `${label}: ogiltig momssats.`)
  const rot = !!l.rot_eligible
  if (rot && line_type !== 'arbete') throw new BillingError(400, `${label}: bara arbete kan vara ROT-berättigat.`)
  return {
    sort_order: idx,
    description,
    line_type,
    quantity,
    unit: text(l.unit, 20),
    unit_price_ex_vat: price,
    vat_rate_bp: vat,
    rot_eligible: rot,
  }
}

function econKey(l: Pick<CalcLine, 'line_type' | 'quantity' | 'unit_price_ex_vat' | 'vat_rate_bp' | 'rot_eligible'>) {
  return [l.line_type, l.quantity, l.unit_price_ex_vat, l.vat_rate_bp, l.rot_eligible].join('|')
}

async function insertLine(q: Queryable, orgId: number, projectId: number, partId: number | null, l: Omit<BillingLine, 'id' | 'part_id'>) {
  const r = await q.query(
    `INSERT INTO billing_lines (org_id, project_id, part_id, sort_order, description, line_type, quantity, unit,
       unit_price_ex_vat, vat_rate_bp, rot_eligible)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [orgId, projectId, partId, l.sort_order, l.description, l.line_type, l.quantity, l.unit, l.unit_price_ex_vat, l.vat_rate_bp, l.rot_eligible]
  )
  return Number(r.rows[0].id)
}

async function log(q: Queryable, ctx: BillingCtx, projectId: number, entityType: string, entityId: number, eventType: string, metadata: Record<string, unknown> = {}) {
  await logActivity(q as any, { orgId: ctx.orgId, userId: ctx.userId, entityType, entityId, projectId, eventType, metadata })
}

/** Ersätter fördelningen för öppna delbetalningar för angivna rader med ett proportionellt förslag. */
async function reproposeAllocations(q: Queryable, orgId: number, projectId: number, onlyLineIds?: Set<number>) {
  const raw = (await loadRaw(q, orgId, projectId))!
  const installments = raw.parts
    .filter((p) => p.kind === 'installment')
    .map((p) => ({ id: Number(p.id), sort_order: Number(p.sort_order), percent_bp: numOrNull(p.percent_bp), status: p.status as PartStatus }))
  const openIds = installments.filter((p) => !isLockedStatus(p.status)).map((p) => p.id)
  if (!openIds.length) return
  const lines = raw.lines.filter((l) => l.part_id === null && (!onlyLineIds || onlyLineIds.has(l.id)))
  if (!lines.length) return
  const proposal = proposeAllocation(lines, installments, raw.allocations).filter((a) => openIds.includes(a.part_id))
  const lineIds = lines.map((l) => l.id)
  await q.query('DELETE FROM billing_allocations WHERE org_id = $1 AND part_id = ANY($2::bigint[]) AND line_id = ANY($3::bigint[])', [
    orgId,
    openIds,
    lineIds,
  ])
  for (const a of proposal) {
    await q.query('INSERT INTO billing_allocations (part_id, line_id, org_id, amount_ex_ore) VALUES ($1,$2,$3,$4)', [
      a.part_id,
      a.line_id,
      orgId,
      a.amount_ex_ore,
    ])
  }
}

// ---------------------------------------------------------------------------
// Mutationer
// ---------------------------------------------------------------------------

export async function updateBillingSettings(db: BillingDb, ctx: BillingCtx, projectId: number, b: Record<string, unknown>) {
  await db.tx(async (q) => {
    const prev = await lockProject(q, ctx.orgId, projectId)
    const next = {
      // Grundavtalets totalsumma räknas fram ur fakturaposterna (saveBaseLines).
      base_total_inc_ore: numOrNull(prev.base_total_inc_ore),
      rot_enabled: b.rot_enabled !== undefined ? !!b.rot_enabled : !!prev.rot_enabled,
      rot_rate_bp: b.rot_rate !== undefined ? percentToBp(b.rot_rate, 'ROT-procentsats') : Number(prev.rot_rate_bp),
      property_designation: b.property_designation !== undefined ? text(b.property_designation, 200) : prev.property_designation,
      housing_type: b.housing_type !== undefined ? text(b.housing_type, 10) : prev.housing_type,
      brf_name: b.brf_name !== undefined ? text(b.brf_name, 200) : prev.brf_name,
      brf_org_number: b.brf_org_number !== undefined ? text(b.brf_org_number, 20) : prev.brf_org_number,
      apartment_number: b.apartment_number !== undefined ? text(b.apartment_number, 20) : prev.apartment_number,
    }
    if (next.housing_type !== null && !['villa', 'brf'].includes(next.housing_type)) throw new BillingError(400, 'Ogiltig bostadstyp.')
    await q.query(
      `UPDATE project_billing SET base_total_inc_ore=$3, rot_enabled=$4, rot_rate_bp=$5, property_designation=$6,
         housing_type=$7, brf_name=$8, brf_org_number=$9, apartment_number=$10, updated_by_user_id=$11, updated_at=now()
       WHERE project_id=$1 AND org_id=$2`,
      [projectId, ctx.orgId, next.base_total_inc_ore, next.rot_enabled, next.rot_rate_bp, next.property_designation,
        next.housing_type, next.brf_name, next.brf_org_number, next.apartment_number, ctx.userId]
    )
    const changes: { field: string; old_value: unknown; new_value: unknown }[] = []
    for (const k of Object.keys(next) as (keyof typeof next)[]) {
      const old = k === 'base_total_inc_ore' || k === 'rot_rate_bp' ? numOrNull(prev[k]) : k === 'rot_enabled' ? !!prev[k] : prev[k] ?? null
      if (old !== next[k]) changes.push({ field: k, old_value: old, new_value: next[k] })
    }
    // Ny ROT-procent gäller som förval för öppna delar.
    if (next.rot_rate_bp !== Number(prev.rot_rate_bp)) {
      await q.query(
        `UPDATE billing_parts SET rot_rate_bp = $3, updated_at = now()
         WHERE org_id = $1 AND project_id = $2 AND locked_at IS NULL AND kind <> 'correction'`,
        [ctx.orgId, projectId, next.rot_rate_bp]
      )
    }
    if (changes.length) await log(q, ctx, projectId, 'project', projectId, 'billing.settings_updated', { changes })
  })
}

/** Ersätter grundunderlagets fakturarader. Rader som ingår i en låst del får inte ändras ekonomiskt eller tas bort. */
export async function saveBaseLines(db: BillingDb, ctx: BillingCtx, projectId: number, input: LineInput[]) {
  if (!Array.isArray(input)) throw new BillingError(400, 'Ogiltiga rader.')
  if (input.length > 500) throw new BillingError(400, 'För många rader.')
  await db.tx(async (q) => {
    await lockProject(q, ctx.orgId, projectId)
    const raw = (await loadRaw(q, ctx.orgId, projectId))!
    const existing = new Map(raw.lines.filter((l) => l.part_id === null).map((l) => [l.id, l]))
    const lockedPartIds = new Set(raw.parts.filter((p) => isLockedStatus(p.status)).map((p) => Number(p.id)))
    const lockedLineIds = new Set(raw.allocations.filter((a) => lockedPartIds.has(a.part_id) && a.amount_ex_ore !== 0).map((a) => a.line_id))
    const parsed = input.map((l, i) => ({ id: l.id ? Number(l.id) : null, ...parseLine(l, i, false) }))
    const keep = new Set<number>()
    const changed = new Set<number>()
    for (const l of parsed) {
      if (l.id !== null) {
        const ex = existing.get(l.id)
        if (!ex) throw new BillingError(400, 'Okänd fakturarad.')
        keep.add(l.id)
        if (econKey(ex) !== econKey(l)) {
          if (lockedLineIds.has(l.id)) {
            throw new BillingError(409, `Raden "${ex.description}" ingår i en fakturerad del och kan inte ändras – skapa en korrigering.`)
          }
          changed.add(l.id)
        }
      }
    }
    const removed = [...existing.keys()].filter((id) => !keep.has(id))
    for (const id of removed) {
      if (lockedLineIds.has(id)) {
        throw new BillingError(409, `Raden "${existing.get(id)!.description}" ingår i en fakturerad del och kan inte tas bort.`)
      }
    }
    if (removed.length) {
      await q.query('DELETE FROM billing_allocations WHERE org_id = $1 AND line_id = ANY($2::bigint[])', [ctx.orgId, removed])
      await q.query('DELETE FROM billing_lines WHERE org_id = $1 AND id = ANY($2::bigint[])', [ctx.orgId, removed])
    }
    for (const l of parsed) {
      if (l.id !== null) {
        await q.query(
          `UPDATE billing_lines SET sort_order=$3, description=$4, line_type=$5, quantity=$6, unit=$7,
             unit_price_ex_vat=$8, vat_rate_bp=$9, rot_eligible=$10 WHERE id=$1 AND org_id=$2`,
          [l.id, ctx.orgId, l.sort_order, l.description, l.line_type, l.quantity, l.unit, l.unit_price_ex_vat, l.vat_rate_bp, l.rot_eligible]
        )
      } else {
        changed.add(await insertLine(q, ctx.orgId, projectId, null, l))
      }
    }
    // Grundavtalets totalsumma = fakturapostenas summa inkl. moms.
    const total = parsed.length ? summarize(lineItems(parsed.map(({ id: _id, ...l }) => l))).inc_ore : null
    await q.query('UPDATE project_billing SET base_total_inc_ore = $3, updated_at = now() WHERE project_id = $1 AND org_id = $2', [
      projectId,
      ctx.orgId,
      total,
    ])
    // Nya/ändrade rader fördelas automatiskt proportionellt; manuellt justerade
    // fördelningar av orörda rader behålls.
    if (changed.size) await reproposeAllocations(q, ctx.orgId, projectId, changed)
    await log(q, ctx, projectId, 'project', projectId, 'billing.lines_updated', {
      count: parsed.length,
      added: parsed.filter((l) => l.id === null).length,
      removed: removed.length,
    })
  })
}

interface InstallmentInput {
  id?: number | null
  name?: unknown
  percent?: unknown
  planned_date?: unknown
  milestone?: unknown
  notes?: unknown
}

/** Sparar betalningsplanen (ordning = arrayens ordning). Låsta delar måste finnas kvar oförändrade. */
export async function saveInstallments(db: BillingDb, ctx: BillingCtx, projectId: number, input: InstallmentInput[]) {
  if (!Array.isArray(input) || input.length > 50) throw new BillingError(400, 'Ogiltig betalningsplan.')
  await db.tx(async (q) => {
    const settings = await lockProject(q, ctx.orgId, projectId)
    const raw = (await loadRaw(q, ctx.orgId, projectId))!
    const existing = new Map(raw.parts.filter((p) => p.kind === 'installment').map((p) => [Number(p.id), p]))
    const seen = new Set<number>()
    let order = 0
    const created: string[] = []
    for (const it of input) {
      order++
      const id = it.id ? Number(it.id) : null
      const name = text(it.name, 200)
      if (!name) throw new BillingError(400, `Delbetalning ${order}: namn krävs.`)
      const percent_bp = percentToBp(it.percent, `Delbetalning ${order}: procentandel`)
      if (id !== null) {
        const ex = existing.get(id)
        if (!ex) throw new BillingError(400, 'Okänd delbetalning.')
        seen.add(id)
        if (isLockedStatus(ex.status)) {
          if (Number(ex.percent_bp) !== percent_bp) {
            throw new BillingError(409, `"${ex.name}" är fakturerad – procentandelen kan inte ändras.`)
          }
          await q.query('UPDATE billing_parts SET sort_order=$3 WHERE id=$1 AND org_id=$2', [id, ctx.orgId, order])
          continue
        }
        await q.query(
          `UPDATE billing_parts SET name=$3, sort_order=$4, percent_bp=$5, planned_date=$6, milestone=$7, notes=$8, updated_at=now()
           WHERE id=$1 AND org_id=$2`,
          [id, ctx.orgId, name, order, percent_bp,
            it.planned_date !== undefined ? dateOrNull(it.planned_date) : ex.planned_date,
            it.milestone !== undefined ? text(it.milestone, 200) : ex.milestone,
            it.notes !== undefined ? text(it.notes, 2000) : ex.notes]
        )
      } else {
        const docNo = await nextDocumentNumber(q, ctx.orgId, projectId)
        const r = await q.query(
          `INSERT INTO billing_parts (org_id, project_id, kind, name, sort_order, percent_bp, planned_date, milestone, notes,
             document_number, rot_rate_bp, created_by_user_id)
           VALUES ($1,$2,'installment',$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [ctx.orgId, projectId, name, order, percent_bp, dateOrNull(it.planned_date), text(it.milestone, 200), text(it.notes, 2000),
            docNo, Number(settings.rot_rate_bp), ctx.userId]
        )
        await createRecipients(q, ctx.orgId, Number(r.rows[0].id))
        created.push(name)
      }
    }
    const removed = [...existing.entries()].filter(([id]) => !seen.has(id))
    for (const [, p] of removed) {
      if (isLockedStatus(p.status)) throw new BillingError(409, `"${p.name}" är fakturerad och kan inte tas bort.`)
    }
    if (removed.length) {
      await q.query('DELETE FROM billing_parts WHERE org_id = $1 AND id = ANY($2::bigint[])', [ctx.orgId, removed.map(([id]) => id)])
    }
    // Ändrad plan → nytt proportionellt förslag för de öppna delarna.
    await reproposeAllocations(q, ctx.orgId, projectId)
    await log(q, ctx, projectId, 'project', projectId, 'billing.plan_updated', {
      installments: input.length,
      created,
      removed: removed.map(([, p]) => p.name),
    })
  })
}

/** Manuell justering av fördelningen (öppna delbetalningar). Kontroll av summor sker i beräkningen. */
export async function saveAllocations(db: BillingDb, ctx: BillingCtx, projectId: number, input: { part_id: unknown; line_id: unknown; amount_ex?: unknown; amount_ex_ore?: unknown }[]) {
  if (!Array.isArray(input) || input.length > 20000) throw new BillingError(400, 'Ogiltig fördelning.')
  await db.tx(async (q) => {
    await lockProject(q, ctx.orgId, projectId)
    const raw = (await loadRaw(q, ctx.orgId, projectId))!
    const openParts = new Set(raw.parts.filter((p) => p.kind === 'installment' && !isLockedStatus(p.status)).map((p) => Number(p.id)))
    const lockedParts = new Set(raw.parts.filter((p) => isLockedStatus(p.status)).map((p) => Number(p.id)))
    const baseLines = new Set(raw.lines.filter((l) => l.part_id === null).map((l) => l.id))
    const rows: AllocationInput[] = []
    const seen = new Set<string>()
    for (const a of input) {
      const part_id = Number(a.part_id)
      const line_id = Number(a.line_id)
      if (lockedParts.has(part_id)) throw new BillingError(409, 'En fakturerad dels fördelning kan inte ändras.')
      if (!openParts.has(part_id) || !baseLines.has(line_id)) throw new BillingError(400, 'Ogiltig fördelning.')
      const key = `${part_id}:${line_id}`
      if (seen.has(key)) throw new BillingError(400, 'Samma rad och del förekommer flera gånger.')
      seen.add(key)
      const amount =
        a.amount_ex_ore !== undefined
          ? Number(a.amount_ex_ore)
          : (oreOrThrow(a.amount_ex, 'Fördelat belopp') as number)
      if (!Number.isSafeInteger(amount) || amount < 0) throw new BillingError(400, 'Fördelat belopp får inte vara negativt.')
      rows.push({ part_id, line_id, amount_ex_ore: amount })
    }
    await q.query('DELETE FROM billing_allocations WHERE org_id = $1 AND part_id = ANY($2::bigint[])', [ctx.orgId, [...openParts]])
    for (const a of rows) {
      await q.query('INSERT INTO billing_allocations (part_id, line_id, org_id, amount_ex_ore) VALUES ($1,$2,$3,$4)', [
        a.part_id,
        a.line_id,
        ctx.orgId,
        a.amount_ex_ore,
      ])
    }
    await log(q, ctx, projectId, 'project', projectId, 'billing.allocation_updated', {})
  })
}

/** Återställer fördelningen till det proportionella förslaget. */
export async function resetAllocations(db: BillingDb, ctx: BillingCtx, projectId: number) {
  await db.tx(async (q) => {
    await lockProject(q, ctx.orgId, projectId)
    await reproposeAllocations(q, ctx.orgId, projectId)
    await log(q, ctx, projectId, 'project', projectId, 'billing.allocation_reset', {})
  })
}

/** Hämtar godkända ÄTA som separata faktureringsdelar. Dubbelhämtning stoppas av projektlåset + unikt index. */
export async function importAta(db: BillingDb, ctx: BillingCtx, projectId: number, ids: unknown) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 200) throw new BillingError(400, 'Välj minst en ÄTA.')
  const wanted = [...new Set(ids.map(Number))]
  if (wanted.some((id) => !Number.isInteger(id) || id <= 0)) throw new BillingError(400, 'Ogiltigt ÄTA-id.')
  return db.tx(async (q) => {
    const settings = await lockProject(q, ctx.orgId, projectId)
    const { rows: items } = await q.query(
      `SELECT id, description, amount, date, ata_status, revision FROM project_line_items
       WHERE org_id = $1 AND project_id = $2 AND type = 'ata' AND id = ANY($3::int[])
       ORDER BY date NULLS LAST, id FOR UPDATE`,
      [ctx.orgId, projectId, wanted]
    )
    if (items.length !== wanted.length) throw new BillingError(404, 'En eller flera ÄTA hittades inte.')
    const notApproved = items.filter((i) => i.ata_status !== 'godkand')
    if (notApproved.length) {
      throw new BillingError(400, `Endast godkända ÄTA kan hämtas: "${notApproved.map((i) => i.description).join('", "')}" är inte godkänd.`)
    }
    const { rows: already } = await q.query(
      "SELECT ata_line_item_id FROM billing_parts WHERE kind = 'ata' AND ata_line_item_id = ANY($1::int[])",
      [wanted]
    )
    const taken = new Set(already.map((r) => Number(r.ata_line_item_id)))
    const { rows: maxRow } = await q.query(
      'SELECT COALESCE(MAX(sort_order), 1000) AS m FROM billing_parts WHERE org_id = $1 AND project_id = $2 AND kind <> $3',
      [ctx.orgId, projectId, 'installment']
    )
    let order = Math.max(1000, Number(maxRow[0].m))
    const created: number[] = []
    const skipped: number[] = []
    for (const it of items) {
      const itemId = Number(it.id)
      if (taken.has(itemId)) {
        skipped.push(itemId)
        continue
      }
      const docNo = await nextDocumentNumber(q, ctx.orgId, projectId)
      const source = { description: it.description, amount: Number(it.amount), date: it.date ?? null }
      // ON CONFLICT: sista skyddet mot dubbel hämtning (unikt index på ata_line_item_id).
      const r = await q.query(
        `INSERT INTO billing_parts (org_id, project_id, kind, name, sort_order, document_number, rot_rate_bp,
           ata_line_item_id, ata_source_revision, ata_source, created_by_user_id)
         VALUES ($1,$2,'ata',$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (ata_line_item_id) WHERE kind = 'ata' DO NOTHING RETURNING id`,
        [ctx.orgId, projectId, String(it.description).slice(0, 200), ++order, docNo, Number(settings.rot_rate_bp), itemId,
          Number(it.revision), JSON.stringify(source), ctx.userId]
      )
      if (!r.rows[0]) {
        skipped.push(itemId)
        continue
      }
      const partId = Number(r.rows[0].id)
      await createRecipients(q, ctx.orgId, partId)
      created.push(partId)
      await log(q, ctx, projectId, 'billing_part', partId, 'billing.ata_imported', {
        description: it.description,
        amount: Number(it.amount),
        document_number: docNo,
      })
    }
    if (!created.length) throw new BillingError(409, 'De valda ÄTA är redan hämtade till fakturering.')
    return { created, skipped }
  })
}

interface RecipientInput {
  position?: unknown
  name?: unknown
  /** undefined = behåll, '' = rensa, annars nytt personnummer. */
  personnummer?: unknown
  amount?: unknown
}

/**
 * Uppdaterar en del. Låsta (fakturerade) delar tillåter bara anteckningar och
 * Fortnox-/extern referens – allt ekonomiskt kräver en korrigering.
 */
export async function updatePart(db: BillingDb, ctx: BillingCtx, partId: number, b: Record<string, unknown>) {
  const projectId = await partProject(db, ctx.orgId, partId)
  await db.tx(async (q) => {
    await lockProject(q, ctx.orgId, projectId)
    const p = (await q.query('SELECT * FROM billing_parts WHERE id = $1 AND org_id = $2 FOR UPDATE', [partId, ctx.orgId])).rows[0]
    if (!p) throw new BillingError(404, 'Hittades inte.')
    const locked = isLockedStatus(p.status)
    const econFields = ['name', 'planned_date', 'milestone', 'rot_rate', 'lines', 'rot_recipients', 'percent']
    const changedFields: string[] = []
    if (locked) {
      const touched = econFields.filter((f) => b[f] !== undefined)
      if (touched.length) {
        throw new BillingError(409, 'Delen är fakturerad och låst – skapa en korrigering för att ändra den.')
      }
    } else {
      if (b.percent !== undefined) throw new BillingError(400, 'Procentandelen ändras i betalningsplanen.')
      const name = b.name !== undefined ? text(b.name, 200) : p.name
      if (!name) throw new BillingError(400, 'Namn krävs.')
      const rot_rate_bp = b.rot_rate !== undefined ? percentToBp(b.rot_rate, 'ROT-procentsats') : Number(p.rot_rate_bp)
      await q.query(
        `UPDATE billing_parts SET name=$3, planned_date=$4, milestone=$5, rot_rate_bp=$6, updated_at=now() WHERE id=$1 AND org_id=$2`,
        [partId, ctx.orgId, name,
          b.planned_date !== undefined ? dateOrNull(b.planned_date) : p.planned_date,
          b.milestone !== undefined ? text(b.milestone, 200) : p.milestone,
          rot_rate_bp]
      )
      for (const f of ['name', 'planned_date', 'milestone', 'rot_rate']) if (b[f] !== undefined) changedFields.push(f)

      if (b.lines !== undefined) {
        if (p.kind === 'installment') throw new BillingError(400, 'Delbetalningens rader styrs av grundunderlaget och fördelningen.')
        if (!Array.isArray(b.lines) || b.lines.length > 500) throw new BillingError(400, 'Ogiltiga rader.')
        const parsed = (b.lines as LineInput[]).map((l, i) => parseLine(l, i, p.kind === 'correction'))
        await q.query('DELETE FROM billing_lines WHERE org_id = $1 AND part_id = $2', [ctx.orgId, partId])
        for (const l of parsed) await insertLine(q, ctx.orgId, projectId, partId, l)
        changedFields.push('lines')
      }

      if (b.rot_recipients !== undefined) {
        if (!Array.isArray(b.rot_recipients)) throw new BillingError(400, 'Ogiltiga ROT-mottagare.')
        await createRecipients(q, ctx.orgId, partId)
        for (const r of b.rot_recipients as RecipientInput[]) {
          const pos = Number(r.position)
          if (pos !== 1 && pos !== 2) throw new BillingError(400, 'Ogiltig ROT-mottagare.')
          const amount = r.amount !== undefined ? (oreOrThrow(r.amount === '' ? 0 : r.amount, `ROT-belopp för person ${pos}`) as number) : undefined
          const sets: string[] = ['name = $4']
          const params: unknown[] = [partId, ctx.orgId, pos, text(r.name, 200)]
          if (amount !== undefined) {
            params.push(amount)
            sets.push(`amount_ore = $${params.length}`)
          }
          if (r.personnummer !== undefined) {
            const raw = String(r.personnummer ?? '').trim()
            if (!raw) {
              sets.push('personnummer_enc = NULL', 'personnummer_last4 = NULL')
            } else {
              const pnr = normalizePersonnummer(raw)
              if (!pnr) throw new BillingError(400, `Ogiltigt personnummer för person ${pos}.`)
              params.push(encryptPnr(pnr))
              sets.push(`personnummer_enc = $${params.length}`)
              params.push(pnr.slice(-4))
              sets.push(`personnummer_last4 = $${params.length}`)
            }
          }
          await q.query(
            `UPDATE billing_rot_recipients SET ${sets.join(', ')} WHERE part_id = $1 AND org_id = $2 AND position = $3`,
            params
          )
        }
        changedFields.push('rot_recipients')
      }
    }
    // Fält som alltid får ändras (påverkar inte belopp).
    if (b.notes !== undefined || b.external_invoice_ref !== undefined) {
      await q.query(
        'UPDATE billing_parts SET notes=$3, external_invoice_ref=$4, updated_at=now() WHERE id=$1 AND org_id=$2',
        [partId, ctx.orgId,
          b.notes !== undefined ? text(b.notes, 2000) : p.notes,
          b.external_invoice_ref !== undefined ? text(b.external_invoice_ref, 100) : p.external_invoice_ref]
      )
      if (b.notes !== undefined) changedFields.push('notes')
      if (b.external_invoice_ref !== undefined) changedFields.push('external_invoice_ref')
    }
    if (changedFields.length) {
      await log(q, ctx, projectId, 'billing_part', partId, 'billing.part_updated', {
        name: p.name,
        document_number: p.document_number,
        fields: changedFields,
      })
    }
  })
}

/** Bekräftar att en öppen ÄTA-del har granskats mot ändrad källpost. */
export async function acknowledgeAtaChange(db: BillingDb, ctx: BillingCtx, partId: number) {
  const projectId = await partProject(db, ctx.orgId, partId)
  await db.tx(async (q) => {
    await lockProject(q, ctx.orgId, projectId)
    const p = (await q.query('SELECT * FROM billing_parts WHERE id = $1 AND org_id = $2 FOR UPDATE', [partId, ctx.orgId])).rows[0]
    if (!p || p.kind !== 'ata') throw new BillingError(404, 'Hittades inte.')
    if (isLockedStatus(p.status)) throw new BillingError(409, 'Delen är fakturerad och låst.')
    const it = (await q.query('SELECT description, amount, date, revision FROM project_line_items WHERE id = $1 AND org_id = $2', [p.ata_line_item_id, ctx.orgId])).rows[0]
    if (!it) throw new BillingError(404, 'Ursprunglig ÄTA hittades inte.')
    await q.query(
      'UPDATE billing_parts SET ata_source=$3, ata_source_revision=$4, updated_at=now() WHERE id=$1 AND org_id=$2',
      [partId, ctx.orgId, JSON.stringify({ description: it.description, amount: Number(it.amount), date: it.date ?? null }), Number(it.revision)]
    )
    await log(q, ctx, projectId, 'billing_part', partId, 'billing.ata_change_acknowledged', {
      old: p.ata_source,
      new: { description: it.description, amount: Number(it.amount) },
    })
  })
}

/** Tar bort en öppen ÄTA-/korrigeringsdel (ÄTA:n kan då hämtas igen). */
export async function deletePart(db: BillingDb, ctx: BillingCtx, partId: number) {
  const projectId = await partProject(db, ctx.orgId, partId)
  await db.tx(async (q) => {
    await lockProject(q, ctx.orgId, projectId)
    const p = (await q.query('SELECT * FROM billing_parts WHERE id = $1 AND org_id = $2 FOR UPDATE', [partId, ctx.orgId])).rows[0]
    if (!p) throw new BillingError(404, 'Hittades inte.')
    if (isLockedStatus(p.status)) throw new BillingError(409, 'En fakturerad del kan inte tas bort – skapa en korrigering.')
    if (p.kind === 'installment') throw new BillingError(400, 'Delbetalningar tas bort i betalningsplanen.')
    await q.query('DELETE FROM billing_parts WHERE id = $1 AND org_id = $2', [partId, ctx.orgId])
    await log(q, ctx, projectId, 'project', projectId, 'billing.part_deleted', { name: p.name, document_number: p.document_number })
  })
}

/** Skapar en korrigering kopplad till en fakturerad del. */
export async function createCorrection(db: BillingDb, ctx: BillingCtx, partId: number) {
  const projectId = await partProject(db, ctx.orgId, partId)
  return db.tx(async (q) => {
    await lockProject(q, ctx.orgId, projectId)
    const p = (await q.query('SELECT * FROM billing_parts WHERE id = $1 AND org_id = $2', [partId, ctx.orgId])).rows[0]
    if (!isLockedStatus(p.status)) throw new BillingError(400, 'Bara fakturerade delar kan korrigeras – öppna delar ändras direkt.')
    const docNo = await nextDocumentNumber(q, ctx.orgId, projectId)
    const { rows: maxRow } = await q.query(
      'SELECT COALESCE(MAX(sort_order), 2000) AS m FROM billing_parts WHERE org_id = $1 AND project_id = $2',
      [ctx.orgId, projectId]
    )
    const r = await q.query(
      `INSERT INTO billing_parts (org_id, project_id, kind, name, sort_order, document_number, rot_rate_bp, corrects_part_id, created_by_user_id)
       VALUES ($1,$2,'correction',$3,$4,$5,$6,$7,$8) RETURNING id`,
      [ctx.orgId, projectId, `Korrigering av ${p.document_number}`, Math.max(2000, Number(maxRow[0].m)) + 1, docNo, Number(p.rot_rate_bp), partId, ctx.userId]
    )
    const id = Number(r.rows[0].id)
    await createRecipients(q, ctx.orgId, id)
    await log(q, ctx, projectId, 'billing_part', id, 'billing.correction_created', {
      document_number: docNo,
      corrects: p.document_number,
    })
    return { id }
  })
}

const TRANSITIONS: Record<PartStatus, PartStatus[]> = {
  planerad: ['klar'],
  klar: ['planerad', 'fakturerad'],
  fakturerad: ['betald'],
  betald: ['fakturerad'],
}

/**
 * Statusövergång. "Klar för fakturering" och "Fakturerad" kräver ett korrekt
 * underlag. "Fakturerad" låser delen och sparar en oföränderlig version.
 */
export async function setPartStatus(
  db: BillingDb,
  ctx: BillingCtx,
  partId: number,
  b: { status?: unknown; invoiced_date?: unknown; external_invoice_ref?: unknown },
  today: string = new Date().toISOString().slice(0, 10)
) {
  const projectId = await partProject(db, ctx.orgId, partId)
  const to = b.status as PartStatus
  if (!(to in TRANSITIONS)) throw new BillingError(400, 'Ogiltig status.')
  return db.tx(async (q) => {
    await lockProject(q, ctx.orgId, projectId)
    const p = (await q.query('SELECT * FROM billing_parts WHERE id = $1 AND org_id = $2 FOR UPDATE', [partId, ctx.orgId])).rows[0]
    const from = p.status as PartStatus
    if (from === to) return
    if (!TRANSITIONS[from].includes(to)) {
      throw new BillingError(409, `Kan inte gå från "${from}" till "${to}".`)
    }
    if (to === 'klar' || to === 'fakturerad') {
      const raw = (await loadRaw(q, ctx.orgId, projectId))!
      const parts = buildParts(raw)
      const input = toInput(raw, parts)
      const calc = computeBilling(input)
      const part = parts.find((x) => x.id === partId)!
      const errors = partBlockingErrors(calc, part)
      if (errors.length) throw new BillingError(400, `Underlaget stämmer inte: ${errors.join(' ')}`)
      if (to === 'fakturerad') {
        const invoicedDate = b.invoiced_date !== undefined ? dateOrNull(b.invoiced_date) ?? today : today
        const extRef = b.external_invoice_ref !== undefined ? text(b.external_invoice_ref, 100) : p.external_invoice_ref
        const r = calc.parts[partId]!
        const summary: LockedSummary = {
          amounts: r.amounts,
          target_inc_ore: r.target_inc_ore,
          max_rot_ore: r.max_rot_ore,
          rot_total_ore: r.rot_total_ore,
          to_pay_ore: r.to_pay_ore,
        }
        await q.query(
          `UPDATE billing_parts SET status='fakturerad', locked_at=now(), locked_summary=$3, invoiced_date=$4,
             external_invoice_ref=$5, updated_at=now() WHERE id=$1 AND org_id=$2`,
          [partId, ctx.orgId, JSON.stringify(summary), invoicedDate, extRef]
        )
        const snapshot = await buildSnapshot(q, ctx.orgId, raw, parts, calc, partId, {
          draft: false,
          document_date: invoicedDate!,
          invoiced_date: invoicedDate,
          external_invoice_ref: extRef,
          locked_summary: summary,
        })
        const { rows: v } = await q.query('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM billing_documents WHERE part_id = $1', [partId])
        snapshot.version = Number(v[0].v)
        await q.query(
          `INSERT INTO billing_documents (org_id, project_id, part_id, document_number, version, snapshot, created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [ctx.orgId, projectId, partId, p.document_number, snapshot.version, JSON.stringify(snapshot), ctx.userId]
        )
        await log(q, ctx, projectId, 'billing_part', partId, 'billing.part_status_changed', {
          name: p.name, document_number: p.document_number, from, to, inc_ore: summary.amounts.inc_ore,
        })
        return
      }
    }
    await q.query('UPDATE billing_parts SET status=$3, updated_at=now() WHERE id=$1 AND org_id=$2', [partId, ctx.orgId, to])
    await log(q, ctx, projectId, 'billing_part', partId, 'billing.part_status_changed', {
      name: p.name, document_number: p.document_number, from, to,
    })
  })
}

/** Registrerar kundbetalning och ROT-uppföljning (endast fakturerade delar). Påverkar aldrig underlaget. */
export async function recordPayments(db: BillingDb, ctx: BillingCtx, partId: number, b: Record<string, unknown>) {
  const projectId = await partProject(db, ctx.orgId, partId)
  await db.tx(async (q) => {
    await lockProject(q, ctx.orgId, projectId)
    const p = (await q.query('SELECT * FROM billing_parts WHERE id = $1 AND org_id = $2 FOR UPDATE', [partId, ctx.orgId])).rows[0]
    if (!isLockedStatus(p.status)) throw new BillingError(400, 'Betalningar registreras när delen är fakturerad.')
    const next = {
      customer_paid_ore: b.customer_paid !== undefined ? (oreOrThrow(b.customer_paid || 0, 'Kundbetalning') as number) : Number(p.customer_paid_ore),
      customer_paid_date: b.customer_paid_date !== undefined ? dateOrNull(b.customer_paid_date) : p.customer_paid_date,
      rot_status: (b.rot_status !== undefined ? b.rot_status : p.rot_status) as RotStatus,
      rot_applied_ore: b.rot_applied !== undefined ? (oreOrThrow(b.rot_applied || 0, 'Sökt ROT') as number) : Number(p.rot_applied_ore),
      rot_applied_date: b.rot_applied_date !== undefined ? dateOrNull(b.rot_applied_date) : p.rot_applied_date,
      rot_paid_ore: b.rot_paid !== undefined ? (oreOrThrow(b.rot_paid || 0, 'Utbetalt ROT') as number) : Number(p.rot_paid_ore),
      rot_paid_date: b.rot_paid_date !== undefined ? dateOrNull(b.rot_paid_date) : p.rot_paid_date,
    }
    if (!['ej_sokt', 'sokt', 'utbetalt', 'avslag'].includes(next.rot_status)) throw new BillingError(400, 'Ogiltig ROT-status.')
    await q.query(
      `UPDATE billing_parts SET customer_paid_ore=$3, customer_paid_date=$4, rot_status=$5, rot_applied_ore=$6,
         rot_applied_date=$7, rot_paid_ore=$8, rot_paid_date=$9, updated_at=now() WHERE id=$1 AND org_id=$2`,
      [partId, ctx.orgId, next.customer_paid_ore, next.customer_paid_date, next.rot_status, next.rot_applied_ore,
        next.rot_applied_date, next.rot_paid_ore, next.rot_paid_date]
    )
    if (next.customer_paid_ore !== Number(p.customer_paid_ore)) {
      await log(q, ctx, projectId, 'billing_part', partId, 'billing.payment_recorded', {
        document_number: p.document_number, old_ore: Number(p.customer_paid_ore), new_ore: next.customer_paid_ore,
      })
    }
    if (next.rot_status !== p.rot_status || next.rot_applied_ore !== Number(p.rot_applied_ore) || next.rot_paid_ore !== Number(p.rot_paid_ore)) {
      await log(q, ctx, projectId, 'billing_part', partId, 'billing.rot_status_changed', {
        document_number: p.document_number, from: p.rot_status, to: next.rot_status,
        applied_ore: next.rot_applied_ore, paid_ore: next.rot_paid_ore,
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Underlag (snapshot för PDF)
// ---------------------------------------------------------------------------

const COMPANY_COLS = ['name', 'organization_number', 'vat_number', 'address', 'postal_code', 'city', 'email', 'phone', 'bankgiro'] as const
const CUSTOMER_COLS = [
  'name', 'organization_number', 'contact_person', 'email', 'phone', 'mobile', 'address', 'postal_code', 'city',
  'billing_address', 'billing_postal_code', 'billing_city', 'billing_email', 'invoice_reference',
] as const

async function buildSnapshot(
  q: Queryable,
  orgId: number,
  raw: RawState,
  parts: BillingPart[],
  calc: BillingResult,
  partId: number,
  opts: { draft: boolean; document_date: string; invoiced_date: string | null; external_invoice_ref: string | null; locked_summary?: LockedSummary }
): Promise<BillingSnapshot> {
  const part = parts.find((p) => p.id === partId)!
  const org = (await q.query('SELECT * FROM organizations WHERE id = $1', [orgId])).rows[0]
  const cust = raw.project.customer_id
    ? (await q.query('SELECT * FROM customers WHERE id = $1 AND org_id = $2', [raw.project.customer_id, orgId])).rows[0]
    : null
  const company: Record<string, string | boolean | null> = {}
  for (const k of COMPANY_COLS) company[k] = strOrNull(org?.[k])
  company.f_skatt = !!org?.f_skatt
  let customer: Record<string, string | null> | null = null
  if (cust) {
    customer = {}
    for (const k of CUSTOMER_COLS) customer[k] = strOrNull(cust[k])
  }

  let lines: SnapshotLine[]
  if (part.kind === 'installment') {
    const base = new Map(raw.lines.filter((l) => l.part_id === null).map((l) => [l.id, l]))
    lines = raw.allocations
      .filter((a) => a.part_id === partId && a.amount_ex_ore !== 0)
      .map((a) => ({ a, l: base.get(a.line_id)! }))
      .filter((x) => x.l)
      .sort((x, y) => x.l.sort_order - y.l.sort_order || x.l.id - y.l.id)
      .map(({ a, l }) => ({
        description: l.description,
        line_type: l.line_type,
        quantity: allocatedQuantity(l, a.amount_ex_ore),
        unit: l.unit,
        unit_price_ex_vat: l.unit_price_ex_vat,
        vat_rate_bp: l.vat_rate_bp,
        ex_ore: a.amount_ex_ore,
        rot_eligible: l.rot_eligible,
      }))
  } else {
    lines = part.lines.map((l) => ({
      description: l.description,
      line_type: l.line_type,
      quantity: l.quantity,
      unit: l.unit,
      unit_price_ex_vat: l.unit_price_ex_vat,
      vat_rate_bp: l.vat_rate_bp,
      ex_ore: lineExOre(l) ?? 0,
      rot_eligible: l.rot_eligible,
    }))
  }
  const r = calc.parts[partId]!
  const recipients = (
    await q.query('SELECT position, name, personnummer_enc, amount_ore FROM billing_rot_recipients WHERE part_id = $1 AND org_id = $2 ORDER BY position', [
      partId,
      orgId,
    ])
  ).rows.map((x) => ({ name: x.name ?? null, personnummer_enc: x.personnummer_enc ?? null, amount_ore: Number(x.amount_ore) }))

  return {
    format: 1,
    draft: opts.draft,
    version: null,
    document_number: part.document_number,
    document_date: opts.document_date,
    company,
    customer,
    project: { project_number: raw.project.project_number, name: raw.project.name, site_address: raw.project.site_address ?? null },
    property: {
      property_designation: raw.settings.property_designation,
      housing_type: raw.settings.housing_type,
      brf_name: raw.settings.brf_name,
      brf_org_number: raw.settings.brf_org_number,
      apartment_number: raw.settings.apartment_number,
    },
    part: {
      kind: part.kind,
      name: part.name,
      percent_bp: part.percent_bp,
      planned_date: part.planned_date,
      milestone: part.milestone,
      ata_reference: part.ata?.source ?? null,
      corrects_document_number: part.corrects_document_number,
    },
    lines,
    summary: opts.locked_summary ?? {
      amounts: r.amounts,
      target_inc_ore: r.target_inc_ore,
      max_rot_ore: r.max_rot_ore,
      rot_total_ore: r.rot_total_ore,
      to_pay_ore: r.to_pay_ore,
    },
    rot: { enabled: raw.settings.rot_enabled && part.kind !== 'correction', rate_bp: part.rot_rate_bp, recipients },
    invoiced_date: opts.invoiced_date,
    external_invoice_ref: opts.external_invoice_ref,
  }
}

/**
 * Underlaget för PDF. Låst del → senaste sparade versionen (oförändrad även om
 * kund/projekt ändrats; bara Fortnox-nummer läggs på om det registrerats
 * senare). Öppen del → aktuellt utkast. `documentId` väljer en viss version.
 */
export async function getPartSnapshot(
  q: Queryable,
  orgId: number,
  partId: number,
  opts: { documentId?: number; today?: string } = {}
): Promise<BillingSnapshot | null> {
  if (!Number.isInteger(partId) || partId <= 0) return null
  const p = (await q.query('SELECT * FROM billing_parts WHERE id = $1 AND org_id = $2', [partId, orgId])).rows[0]
  if (!p) return null
  if (isLockedStatus(p.status) || opts.documentId) {
    const doc = (
      await q.query(
        opts.documentId
          ? 'SELECT snapshot FROM billing_documents WHERE part_id = $1 AND org_id = $2 AND id = $3'
          : 'SELECT snapshot FROM billing_documents WHERE part_id = $1 AND org_id = $2 ORDER BY version DESC LIMIT 1',
        opts.documentId ? [partId, orgId, opts.documentId] : [partId, orgId]
      )
    ).rows[0]
    if (!doc) return null
    const snap = (typeof doc.snapshot === 'string' ? JSON.parse(doc.snapshot) : doc.snapshot) as BillingSnapshot
    return { ...snap, external_invoice_ref: p.external_invoice_ref ?? snap.external_invoice_ref }
  }
  const projectId = Number(p.project_id)
  const raw = (await loadRaw(q, orgId, projectId))!
  const parts = buildParts(raw)
  const calc = computeBilling(toInput(raw, parts))
  return buildSnapshot(q, orgId, raw, parts, calc, partId, {
    draft: true,
    document_date: opts.today ?? new Date().toISOString().slice(0, 10),
    invoiced_date: null,
    external_invoice_ref: p.external_invoice_ref ?? null,
  })
}

/** Klartextpersonnummer för redigering av en del (endast behöriga, endast denna endpoint). */
export async function getPartRecipientsPlain(q: Queryable, orgId: number, partId: number, decrypt: (s: string) => string) {
  const { rows } = await q.query(
    'SELECT position, name, personnummer_enc, amount_ore FROM billing_rot_recipients WHERE part_id = $1 AND org_id = $2 ORDER BY position',
    [partId, orgId]
  )
  if (!rows.length) {
    const exists = await q.query('SELECT 1 FROM billing_parts WHERE id = $1 AND org_id = $2', [partId, orgId])
    if (!exists.rows.length) return null
  }
  return [1, 2].map((pos) => {
    const r = rows.find((x) => Number(x.position) === pos)
    return {
      position: pos,
      name: r?.name ?? null,
      personnummer: r?.personnummer_enc ? decrypt(r.personnummer_enc) : '',
      amount_ore: num(r?.amount_ore),
    }
  })
}

// ---------------------------------------------------------------------------
// ÄTA-status (befintliga ÄTA-funktionen)
// ---------------------------------------------------------------------------

export const ATA_STATUSES: AtaStatus[] = ['utkast', 'skickad', 'godkand', 'avbojd']

/** Får ÄTA-raden ändra status/tas bort? Hämtade ÄTA måste förbli godkända. */
export async function ataBillingPart(q: Queryable, orgId: number, lineItemId: number) {
  const r = (
    await q.query("SELECT id, status, document_number FROM billing_parts WHERE org_id = $1 AND kind = 'ata' AND ata_line_item_id = $2", [
      orgId,
      lineItemId,
    ])
  ).rows[0]
  return r ? { id: Number(r.id), status: r.status as PartStatus, document_number: r.document_number as string } : null
}
