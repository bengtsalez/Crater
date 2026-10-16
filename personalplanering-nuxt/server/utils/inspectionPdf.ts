// PDF för egenkontroller och checklistor: en enskild kontroll samt ett samlat
// slutprotokoll per projekt. Ren JS via pdf-lib (fungerar i Netlify Functions).
//
//  - A4, Helvetica (WinAnsi: å/ä/ö/é), sidnumrering "Sida i av n".
//  - Varje punkt mäts innan den ritas och flyttas hel till nästa sida – rader
//    kapas aldrig mitt i. Bilder skalas in i sin ruta och roteras enligt EXIF.
//  - Ej godkända kontroller märks tydligt med sin faktiska status.
//  - Länkar till kontrollunderlag skrivs bara ut som text – inga nätverksanrop.
//    Bilder läses via `loadImage` (egen lagring), aldrig från godtyckliga adresser.
//
// Nitro-fri: testas i server/utils/inspectionPdf.spec.ts.

import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import {
  DEVIATION_STATUS_LABELS,
  formatAnswerValue,
  INSPECTION_KIND_LABELS,
  INSPECTION_STATUS_LABELS,
  type Coverage,
  type InspectionStatus,
} from '../../shared/inspections'
import type { InspectionSnapshot, SnapshotPhoto } from '../../shared/inspectionTypes'
import { PDF_A4, pdfSanitizer, pdfWrap } from './pdfCommon'

const A4 = PDF_A4
const M = 42
const W = A4[0] - 2 * M
const BOTTOM = M + 24
const PRIMARY = rgb(0x25 / 255, 0x63 / 255, 0xeb / 255)
const TEXT = rgb(0.12, 0.14, 0.18)
const MUTED = rgb(0.42, 0.45, 0.5)
const RULE = rgb(0.85, 0.87, 0.9)
const HEAD_BG = rgb(0.94, 0.96, 1)
const WARN_BG = rgb(1, 0.95, 0.88)
const DANGER = rgb(0.75, 0.1, 0.1)
const OK = rgb(0.1, 0.5, 0.25)

export interface InspectionPdfOptions {
  /** Hämtar bildbytes för en lagringsnyckel (null = saknas/ej konfigurerad). */
  loadImage?: (storageKey: string) => Promise<Uint8Array | null>
}

interface Writer {
  doc: PDFDocument
  font: PDFFont
  bold: PDFFont
  page: PDFPage
  y: number
  S: (s: string | null | undefined) => string
  /** Vattenstämpel per sida (null = ingen). */
  marks: Map<PDFPage, string | null>
  currentMark: string | null
  images: Map<string, PDFImage | null>
}

function newPage(w: Writer) {
  w.page = w.doc.addPage(A4)
  w.y = A4[1] - M
  w.marks.set(w.page, w.currentMark)
}

function ensure(w: Writer, h: number) {
  if (w.y - h < BOTTOM) newPage(w)
}

const usable = A4[1] - M - BOTTOM

function text(w: Writer, s: string, x: number, y: number, size = 9, f?: PDFFont, color = TEXT) {
  w.page.drawText(w.S(s), { x, y, size, font: f ?? w.font, color })
}

function lines(w: Writer, s: string | null | undefined, size: number, width: number, f?: PDFFont): string[] {
  return pdfWrap(f ?? w.font, w.S(s ?? ''), size, width)
}

/** Ett textblock (rubrik + värde) som mäts först och ritas helt på en sida. */
interface Row {
  label: string
  value: string
  color?: ReturnType<typeof rgb>
  bold?: boolean
}

const LABEL_W = 110
const LH = 11.5

function measureRows(w: Writer, rows: Row[], width: number) {
  return rows.map((r) => ({ ...r, lines: lines(w, r.value, 9, width - LABEL_W, r.bold ? w.bold : w.font) }))
}

function drawRows(w: Writer, rows: ReturnType<typeof measureRows>, x: number) {
  for (const r of rows) {
    // En enskild rad som inte ryms på en hel sida bryts mellan textrader (aldrig mitt i en rad).
    const h = r.lines.length * LH
    if (h <= usable) ensure(w, h)
    text(w, r.label, x, w.y - 8, 8, w.font, MUTED)
    for (const l of r.lines) {
      if (w.y - LH < BOTTOM) newPage(w)
      text(w, l, x + LABEL_W, w.y - 8, 9, r.bold ? w.bold : w.font, r.color ?? TEXT)
      w.y -= LH
    }
    w.y -= 1.5
  }
}

const rowsHeight = (rows: { lines: string[] }[]) => rows.reduce((n, r) => n + r.lines.length * LH + 1.5, 0)

async function embed(w: Writer, p: SnapshotPhoto, opts: InspectionPdfOptions): Promise<PDFImage | null> {
  if (w.images.has(p.storage_key)) return w.images.get(p.storage_key)!
  let img: PDFImage | null = null
  try {
    const bytes = opts.loadImage ? await opts.loadImage(p.storage_key) : null
    if (bytes) {
      if (p.content_type === 'image/jpeg') img = await w.doc.embedJpg(bytes)
      else if (p.content_type === 'image/png') img = await w.doc.embedPng(bytes)
    }
  } catch {
    img = null
  }
  w.images.set(p.storage_key, img)
  return img
}

const PHOTO_COLS = 2
const PHOTO_GAP = 10
const PHOTO_MAX_H = 230

/** Ritar bilder i rader om två; varje rad ryms alltid helt på sidan. */
async function drawPhotos(w: Writer, photos: SnapshotPhoto[], x: number, width: number, opts: InspectionPdfOptions) {
  if (!photos.length) return
  const cellW = (width - PHOTO_GAP * (PHOTO_COLS - 1)) / PHOTO_COLS
  for (let i = 0; i < photos.length; i += PHOTO_COLS) {
    const row = photos.slice(i, i + PHOTO_COLS)
    const placed: { p: SnapshotPhoto; img: PDFImage | null; dw: number; dh: number }[] = []
    for (const p of row) {
      const img = await embed(w, p, opts)
      if (!img) {
        placed.push({ p, img: null, dw: cellW, dh: 28 })
        continue
      }
      const rotated = p.exif_orientation !== null && p.exif_orientation >= 5 && p.exif_orientation <= 8
      const iw = rotated ? img.height : img.width
      const ih = rotated ? img.width : img.height
      const scale = Math.min(cellW / iw, PHOTO_MAX_H / ih, 1)
      placed.push({ p, img, dw: iw * scale, dh: ih * scale })
    }
    const rowH = Math.max(...placed.map((pl) => pl.dh)) + 6
    ensure(w, rowH)
    placed.forEach((pl, j) => {
      const bx = x + j * (cellW + PHOTO_GAP)
      const by = w.y - pl.dh
      if (!pl.img) {
        w.page.drawRectangle({ x: bx, y: by, width: pl.dw, height: pl.dh, borderColor: RULE, borderWidth: 0.6 })
        const why = pl.p.content_type === 'image/webp' ? 'Bild i WebP-format – visas i Crater' : 'Bilden kunde inte läsas in'
        text(w, why, bx + 6, by + 10, 8, w.font, MUTED)
        return
      }
      const o = pl.p.exif_orientation ?? 1
      // Rotation kring nedre vänstra hörnet; räkna om ankarpunkten så att
      // den roterade bilden hamnar exakt i rutan (bx, by, dw, dh).
      if (o === 6 || o === 5) {
        w.page.drawImage(pl.img, { x: bx, y: by + pl.dh, width: pl.dh, height: pl.dw, rotate: degrees(-90) })
      } else if (o === 8 || o === 7) {
        w.page.drawImage(pl.img, { x: bx + pl.dw, y: by, width: pl.dh, height: pl.dw, rotate: degrees(90) })
      } else if (o === 3 || o === 4) {
        w.page.drawImage(pl.img, { x: bx + pl.dw, y: by + pl.dh, width: pl.dw, height: pl.dh, rotate: degrees(180) })
      } else {
        w.page.drawImage(pl.img, { x: bx, y: by, width: pl.dw, height: pl.dh })
      }
    })
    w.y -= rowH
  }
}

const fmtTime = (isoStr: string | null) =>
  isoStr
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'short', timeStyle: 'short' }).format(new Date(isoStr))
    : ''

const coverageText = (c: Coverage) =>
  `${c.required_answered} av ${c.required_total} obligatoriska punkter besvarade${c.incomplete ? ` · ${c.incomplete} uppfyller inte kraven` : ''}`

function heading(w: Writer, s: string, size = 11) {
  ensure(w, size + 14)
  text(w, s, M, w.y - size, size, w.bold, PRIMARY)
  w.y -= size + 8
}

function rule(w: Writer) {
  w.page.drawLine({ start: { x: M, y: w.y }, end: { x: M + W, y: w.y }, thickness: 0.5, color: RULE })
  w.y -= 8
}

async function drawInspection(w: Writer, snap: InspectionSnapshot, opts: InspectionPdfOptions) {
  const ins = snap.inspection
  const approved = ins.status === 'approved'
  w.currentMark = approved ? null : `EJ GODKÄND – ${INSPECTION_STATUS_LABELS[ins.status as InspectionStatus].toUpperCase()}`
  newPage(w)

  // ---- Rubrik ----
  text(w, snap.org.name, M, w.y - 9, 9, w.bold, MUTED)
  w.y -= 14
  const titleLines = lines(w, `${INSPECTION_KIND_LABELS[ins.kind]}: ${ins.name}`, 16, W, w.bold)
  for (const l of titleLines) {
    text(w, l, M, w.y - 15, 16, w.bold, PRIMARY)
    w.y -= 19
  }
  // Statusruta – syns direkt vilket läge protokollet har.
  const statusLabel = `Status: ${INSPECTION_STATUS_LABELS[ins.status as InspectionStatus]}`
  const sw = w.bold.widthOfTextAtSize(w.S(statusLabel), 10) + 14
  w.page.drawRectangle({ x: M, y: w.y - 18, width: sw, height: 18, color: approved ? rgb(0.88, 0.97, 0.9) : WARN_BG })
  text(w, statusLabel, M + 7, w.y - 13, 10, w.bold, approved ? OK : DANGER)
  w.y -= 28

  const p = snap.project
  const meta: Row[] = [
    { label: 'Projekt', value: `${p.project_number} – ${p.name}` },
    { label: 'Kund', value: p.customer_name ?? '–' },
    { label: 'Arbetsplats', value: p.site_address ?? '–' },
    { label: 'Plats / etapp', value: ins.location ?? '–' },
    { label: 'Mall', value: `${ins.template_name ?? ins.name}, version ${ins.template_version}` },
    { label: 'Kontrollrevision', value: `${ins.revision}${ins.revision_reason ? ` – orsak: ${ins.revision_reason}` : ''}` },
    { label: 'Ansvarig', value: ins.responsible_name ?? '–' },
    { label: 'Sista datum', value: ins.due_date ?? '–' },
    { label: 'Svarstäckning', value: coverageText(snap.coverage) },
  ]
  if (ins.submitted_at) meta.push({ label: 'Inlämnad', value: `${fmtTime(ins.submitted_at)} av ${ins.submitted_by_name ?? '–'}` })
  if (approved) {
    meta.push({ label: 'Godkänd', value: `${fmtTime(ins.approved_at)} av ${ins.approved_by_name ?? '–'}`, bold: true, color: OK })
    if (ins.approval_comment) meta.push({ label: 'Granskarens kommentar', value: ins.approval_comment })
  } else {
    meta.push({ label: 'Godkännande', value: 'Kontrollen är inte godkänd.', bold: true, color: DANGER })
    if (ins.review_comment && ins.status === 'changes_requested') meta.push({ label: 'Begärd komplettering', value: ins.review_comment })
  }
  if (ins.description) meta.push({ label: 'Beskrivning', value: ins.description })
  drawRows(w, measureRows(w, meta, W), M)
  w.y -= 4
  rule(w)

  // ---- Punkter per avsnitt ----
  let section: string | null = null
  let n = 0
  for (const it of snap.items) {
    if (it.section_title !== section) {
      section = it.section_title
      if (section) heading(w, section, 11)
    }
    n++
    const a = it.answer
    const rows: Row[] = []
    const result = formatAnswerValue(it, a)
    rows.push({
      label: 'Resultat',
      value: result,
      bold: true,
      color: a?.result === 'deviation' ? DANGER : result === 'Obesvarad' ? MUTED : TEXT,
    })
    if (a?.comment) rows.push({ label: 'Kommentar', value: a.comment })
    if (a?.result === 'na' && a.na_reason) rows.push({ label: 'Motivering', value: a.na_reason })
    if (a) rows.push({ label: 'Utförd av', value: `${a.answered_by_name ?? '–'}, ${fmtTime(a.answered_at)}` })
    if (it.instruction) rows.push({ label: 'Instruktion', value: it.instruction })
    if (it.basis || it.basis_url) rows.push({ label: 'Kontrollunderlag', value: [it.basis, it.basis_url].filter(Boolean).join(' – ') })
    if (it.method) rows.push({ label: 'Kontrollmetod', value: it.method })
    const req = [
      it.required ? 'obligatorisk' : 'frivillig',
      it.min_photos ? `minst ${it.min_photos} ${it.min_photos === 1 ? 'bild' : 'bilder'}` : null,
      it.comment_required ? 'kommentar krävs' : null,
      it.critical ? 'KRITISKT MOMENT' : null,
    ]
      .filter(Boolean)
      .join(', ')
    rows.push({ label: 'Krav', value: req })
    if (it.timing_note) rows.push({ label: 'När', value: it.timing_note })
    if (!it.evaluation.complete) rows.push({ label: 'Saknas', value: it.evaluation.problems.join(', '), color: DANGER })

    const titleL = lines(w, `${n}. ${it.title}`, 10, W, w.bold)
    const measured = measureRows(w, rows, W - 10)
    const blockH = titleL.length * 13 + rowsHeight(measured) + 6
    if (blockH <= usable) ensure(w, blockH)
    else ensure(w, titleL.length * 13 + LH * 2)
    for (const l of titleL) {
      text(w, l, M, w.y - 10, 10, w.bold, it.critical ? DANGER : TEXT)
      w.y -= 13
    }
    drawRows(w, measured, M + 10)
    await drawPhotos(w, it.photos, M + 10, W - 10, opts)
    w.y -= 4
    ensure(w, 8)
    rule(w)
  }

  // ---- Avvikelser ----
  if (snap.deviations.length) {
    heading(w, `Avvikelser (${snap.deviations.length})`, 12)
    for (const d of snap.deviations) {
      const rows: Row[] = [
        { label: 'Status', value: DEVIATION_STATUS_LABELS[d.status], bold: true, color: d.status === 'verified' ? OK : DANGER },
        { label: 'Beskrivning', value: d.description },
        { label: 'Rapporterad', value: `${fmtTime(d.created_at)} av ${d.reported_by_name ?? '–'}` },
        { label: 'Ansvarig', value: d.responsible_name ?? '–' },
      ]
      if (d.due_date) rows.push({ label: 'Sista datum', value: d.due_date })
      if (d.action_description) rows.push({ label: 'Åtgärd', value: d.action_description })
      if (d.resolved_at) rows.push({ label: 'Åtgärdad', value: `${fmtTime(d.resolved_at)} av ${d.resolved_by_name ?? '–'}` })
      if (d.verified_at) rows.push({ label: 'Verifierad', value: `${fmtTime(d.verified_at)} av ${d.verified_by_name ?? '–'}` })
      if (d.reopen_reason) rows.push({ label: 'Återöppnad, orsak', value: d.reopen_reason })
      const titleL = lines(w, `Punkt: ${d.item_title}`, 10, W, w.bold)
      const measured = measureRows(w, rows, W - 10)
      const blockH = titleL.length * 13 + rowsHeight(measured) + 6
      if (blockH <= usable) ensure(w, blockH)
      for (const l of titleL) {
        text(w, l, M, w.y - 10, 10, w.bold)
        w.y -= 13
      }
      drawRows(w, measured, M + 10)
      await drawPhotos(w, d.photos, M + 10, W - 10, opts)
      w.y -= 4
      ensure(w, 8)
      rule(w)
    }
  }

  // ---- Historik (granskning) ----
  const review = snap.events.filter((e) => ['submitted', 'changes_requested', 'approved', 'revision_created', 'archived'].includes(e.event_type))
  if (review.length) {
    heading(w, 'Granskningshistorik', 11)
    const label: Record<string, string> = {
      submitted: 'Inlämnad',
      changes_requested: 'Komplettering begärd',
      approved: 'Godkänd',
      revision_created: 'Ny revision',
      archived: 'Arkiverad',
    }
    const rows = measureRows(
      w,
      review.map((e) => ({
        label: fmtTime(e.created_at),
        value: `${label[e.event_type] ?? e.event_type} – ${e.user_name ?? '–'}${e.comment ? `: ${e.comment}` : ''}`,
      })),
      W
    )
    drawRows(w, rows, M)
  }
}

async function createWriter(): Promise<Writer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  doc.setCreator('Crater')
  doc.setProducer('Crater')
  return {
    doc,
    font,
    bold,
    page: undefined as unknown as PDFPage,
    y: 0,
    S: pdfSanitizer(font, { keepNewlines: true }),
    marks: new Map(),
    currentMark: null,
    images: new Map(),
  }
}

function finish(w: Writer, footer: string) {
  const pages = w.doc.getPages()
  const S1 = pdfSanitizer(w.font)
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: M - 6 }, end: { x: M + W, y: M - 6 }, thickness: 0.5, color: RULE })
    pg.drawText(S1(`${footer} · Sida ${i + 1} av ${pages.length}`), { x: M, y: M - 18, size: 7.5, font: w.font, color: MUTED })
    const mark = w.marks.get(pg)
    if (mark) {
      const size = 34
      const t = S1(mark)
      const tw = w.bold.widthOfTextAtSize(t, size)
      // Diagonalt genom sidans mitt.
      const cx = A4[0] / 2
      const cy = A4[1] / 2
      const a = Math.PI / 5
      pg.drawText(t, {
        x: cx - (tw / 2) * Math.cos(a),
        y: cy - (tw / 2) * Math.sin(a),
        size,
        font: w.bold,
        color: DANGER,
        opacity: 0.1,
        rotate: degrees((a * 180) / Math.PI),
      })
    }
  })
}

export async function renderInspectionPdf(snap: InspectionSnapshot, opts: InspectionPdfOptions = {}): Promise<Uint8Array> {
  const w = await createWriter()
  w.doc.setTitle(w.S(`${INSPECTION_KIND_LABELS[snap.inspection.kind]} ${snap.inspection.name}`))
  await drawInspection(w, snap, opts)
  const ins = snap.inspection
  finish(
    w,
    `${INSPECTION_KIND_LABELS[ins.kind]} ${ins.name}${ins.location ? ` (${ins.location})` : ''} · rev ${ins.revision} · ${INSPECTION_STATUS_LABELS[ins.status as InspectionStatus]} · ${snap.project.project_number} · ${snap.org.name}`
  )
  return w.doc.save()
}

// ---- Slutprotokoll ----

export interface ProtocolInput {
  org: { name: string }
  project: InspectionSnapshot['project']
  generated_at: string
  /** Alla aktuella kontroller (ej ersatta, ej arkiverade). */
  inspections: {
    name: string
    kind: InspectionSnapshot['inspection']['kind']
    location: string | null
    status: InspectionStatus
    revision: number
    coverage: Coverage
    open_deviations: number
  }[]
  /** Godkända kontrollers låsta ögonblicksbilder. */
  approved: InspectionSnapshot[]
  /** Avvikelser som inte är verifierade. */
  open_deviations: {
    inspection_name: string
    location: string | null
    item_title: string
    description: string
    status: 'open' | 'resolved' | 'verified'
    responsible_name: string | null
    due_date: string | null
  }[]
}

export function protocolIsComplete(input: Pick<ProtocolInput, 'inspections' | 'open_deviations'>) {
  return (
    input.inspections.length > 0 && input.inspections.every((i) => i.status === 'approved') && input.open_deviations.length === 0
  )
}

export async function renderFinalProtocol(input: ProtocolInput, opts: InspectionPdfOptions = {}): Promise<Uint8Array> {
  const w = await createWriter()
  const complete = protocolIsComplete(input)
  const title = complete ? 'Slutprotokoll – egenkontroller' : 'Ofullständigt slutprotokoll – egenkontroller'
  w.doc.setTitle(w.S(`${title} ${input.project.project_number}`))
  w.currentMark = complete ? null : 'OFULLSTÄNDIGT'
  newPage(w)
  text(w, input.org.name, M, w.y - 9, 9, w.bold, MUTED)
  w.y -= 14
  for (const l of lines(w, title, 16, W, w.bold)) {
    text(w, l, M, w.y - 15, 16, w.bold, complete ? PRIMARY : DANGER)
    w.y -= 19
  }
  const p = input.project
  drawRows(
    w,
    measureRows(
      w,
      [
        { label: 'Projekt', value: `${p.project_number} – ${p.name}` },
        { label: 'Kund', value: p.customer_name ?? '–' },
        { label: 'Arbetsplats', value: p.site_address ?? '–' },
        { label: 'Sammanställt', value: fmtTime(input.generated_at) },
      ],
      W
    ),
    M
  )
  w.y -= 6
  const approvedCount = input.inspections.filter((i) => i.status === 'approved').length
  const remaining = input.inspections.length - approvedCount
  const statement = !input.inspections.length
    ? 'Inga egenkontroller eller checklistor har lagts till på projektet. Protokollet visar därför inte att arbetet är kontrollerat.'
    : complete
      ? `Samtliga ${approvedCount} kontroller är godkända och alla avvikelser är verifierade.`
      : `Observera: protokollet är ofullständigt. ${approvedCount} av ${input.inspections.length} kontroller är godkända${remaining ? `, ${remaining} återstår` : ''}${input.open_deviations.length ? ` och ${input.open_deviations.length} ${input.open_deviations.length === 1 ? 'avvikelse är' : 'avvikelser är'} inte verifierade` : ''}.`
  const st = lines(w, statement, 10, W - 16, w.bold)
  const boxH = st.length * 13 + 12
  ensure(w, boxH)
  w.page.drawRectangle({ x: M, y: w.y - boxH, width: W, height: boxH, color: complete ? rgb(0.88, 0.97, 0.9) : WARN_BG })
  st.forEach((l, i) => text(w, l, M + 8, w.y - 15 - i * 13, 10, w.bold, complete ? OK : DANGER))
  w.y -= boxH + 12

  if (input.inspections.length) {
    heading(w, 'Kontroller', 12)
    const drawHead = () => {
      w.page.drawRectangle({ x: M, y: w.y - 14, width: W, height: 16, color: HEAD_BG })
      text(w, 'Kontroll', M + 4, w.y - 10, 8, w.bold)
      text(w, 'Plats / etapp', M + W * 0.42, w.y - 10, 8, w.bold)
      text(w, 'Status', M + W * 0.62, w.y - 10, 8, w.bold)
      text(w, 'Besvarade', M + W * 0.85, w.y - 10, 8, w.bold)
      w.y -= 20
    }
    ensure(w, 40)
    drawHead()
    for (const i of input.inspections) {
      const nl = lines(w, `${INSPECTION_KIND_LABELS[i.kind]}: ${i.name}${i.revision > 1 ? ` (rev ${i.revision})` : ''}`, 9, W * 0.4)
      const ll = lines(w, i.location ?? '–', 9, W * 0.19)
      const sl = lines(w, INSPECTION_STATUS_LABELS[i.status], 9, W * 0.22, w.bold)
      const h = Math.max(nl.length, ll.length, sl.length) * LH + 4
      if (w.y - h < BOTTOM) {
        newPage(w)
        drawHead()
      }
      nl.forEach((l, k) => text(w, l, M + 4, w.y - 8 - k * LH))
      ll.forEach((l, k) => text(w, l, M + W * 0.42, w.y - 8 - k * LH))
      sl.forEach((l, k) => text(w, l, M + W * 0.62, w.y - 8 - k * LH, 9, w.bold, i.status === 'approved' ? OK : DANGER))
      text(w, `${i.coverage.required_answered}/${i.coverage.required_total}`, M + W * 0.85, w.y - 8)
      w.y -= h
      w.page.drawLine({ start: { x: M, y: w.y + 2 }, end: { x: M + W, y: w.y + 2 }, thickness: 0.3, color: RULE })
    }
    w.y -= 8
  }

  if (input.open_deviations.length) {
    heading(w, `Kvarstående avvikelser (${input.open_deviations.length})`, 12)
    for (const d of input.open_deviations) {
      const rows = measureRows(
        w,
        [
          { label: 'Kontroll', value: `${d.inspection_name}${d.location ? ` (${d.location})` : ''}` },
          { label: 'Punkt', value: d.item_title },
          { label: 'Beskrivning', value: d.description },
          { label: 'Status', value: DEVIATION_STATUS_LABELS[d.status], bold: true, color: DANGER },
          { label: 'Ansvarig / sista datum', value: `${d.responsible_name ?? '–'}${d.due_date ? ` / ${d.due_date}` : ''}` },
        ],
        W
      )
      const h = rowsHeight(rows) + 8
      if (h <= usable) ensure(w, h)
      drawRows(w, rows, M)
      rule(w)
    }
  }

  for (const snap of input.approved) await drawInspection(w, snap, opts)

  finish(w, `${complete ? 'Slutprotokoll' : 'Ofullständigt slutprotokoll'} · ${p.project_number} ${p.name} · ${input.org.name}`)
  return w.doc.save()
}

export function inspectionPdfFilename(snap: InspectionSnapshot): string {
  const ins = snap.inspection
  const base = `${INSPECTION_KIND_LABELS[ins.kind]}-${snap.project.project_number}-${ins.name}${ins.location ? `-${ins.location}` : ''}-rev${ins.revision}${ins.status === 'approved' ? '' : `-${ins.status}`}`
  return asciiFilename(base) + '.pdf'
}

export function protocolPdfFilename(projectNumber: string, complete: boolean): string {
  return asciiFilename(`Slutprotokoll-${projectNumber}${complete ? '' : '-ofullstandigt'}`) + '.pdf'
}

function asciiFilename(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 150)
}
