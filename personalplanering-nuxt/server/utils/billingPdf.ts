// PDF för faktureringsunderlag (inte en faktura). Ren JS via pdf-lib – inga
// filsystemsberoenden eller headless-browser, fungerar i Netlify Functions.
// Standardfonten Helvetica (WinAnsi) täcker å/ä/ö/é/²/³; tecken utanför
// teckenuppsättningen ersätts i sanitize().
//
// Nitro-fri: testas direkt i server/utils/billingPdf.spec.ts.

import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib'
import {
  displayPrice,
  formatOre,
  formatPercentBp,
  formatPersonnummer,
  LINE_TYPE_LABELS,
  PART_KIND_LABELS,
  type LineType,
} from '../../shared/billing'
import type { BillingSnapshot, SnapshotLine } from '../../shared/billingTypes'
import { pdfSanitizer, pdfWrap } from './pdfCommon'

const A4: [number, number] = [595.28, 841.89]
const M = 42 // marginal
const PRIMARY = rgb(0x25 / 255, 0x63 / 255, 0xeb / 255) // --primary #2563eb
const TEXT = rgb(0.12, 0.14, 0.18)
const MUTED = rgb(0.42, 0.45, 0.5)
const RULE = rgb(0.85, 0.87, 0.9)
const HEAD_BG = rgb(0.94, 0.96, 1)

interface Ctx {
  doc: PDFDocument
  font: PDFFont
  bold: PDFFont
  page: PDFPage
  y: number
  snap: BillingSnapshot
  /** Ritar om tabellhuvudet efter sidbrytning (när en tabell pågår). */
  repeatHeader: (() => void) | null
}

const sanitizer = pdfSanitizer

function newPage(c: Ctx) {
  c.page = c.doc.addPage(A4)
  c.y = A4[1] - M
  if (c.repeatHeader) c.repeatHeader()
}

function ensure(c: Ctx, h: number) {
  if (c.y - h < M + 30) newPage(c)
}

const wrap = pdfWrap

export async function renderBillingPdf(
  snap: BillingSnapshot,
  opts: { decryptPnr?: (enc: string) => string } = {}
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const S = sanitizer(font)
  const title = snap.draft ? 'Faktureringsunderlag – UTKAST' : 'Faktureringsunderlag'
  doc.setTitle(S(`${title} ${snap.document_number}`))
  doc.setCreator('Crater')
  doc.setProducer('Crater')

  const c: Ctx = { doc, font, bold, page: doc.addPage(A4), y: A4[1] - M, snap, repeatHeader: null }
  const W = A4[0] - 2 * M

  const text = (s: string, x: number, y: number, size = 9, f: PDFFont = font, color = TEXT) =>
    c.page.drawText(S(s), { x, y, size, font: f, color })
  const rightText = (s: string, xRight: number, y: number, size = 9, f: PDFFont = font, color = TEXT) => {
    const t = S(s)
    c.page.drawText(t, { x: xRight - f.widthOfTextAtSize(t, size), y, size, font: f, color })
  }
  const rule = (y: number, color = RULE, thickness = 0.6) =>
    c.page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness, color })

  // ---- Rubrik ----
  text(title, M, c.y - 16, 18, bold, PRIMARY)
  const meta: [string, string][] = [
    ['Underlagsnr', snap.document_number],
    ['Datum', snap.document_date],
  ]
  if (snap.version) meta.push(['Version', String(snap.version)])
  if (snap.invoiced_date) meta.push(['Fakturadatum', snap.invoiced_date])
  if (snap.external_invoice_ref) meta.push(['Fortnox fakturanr', snap.external_invoice_ref])
  let my = c.y - 4
  for (const [k, v] of meta) {
    rightText(v, M + W, my - 8, 9, bold)
    rightText(`${k}:`, M + W - 110, my - 8, 9, font, MUTED)
    my -= 12
  }
  c.y = Math.min(c.y - 30, my) - 6
  text('Underlag för fakturering – detta dokument är inte en faktura.', M, c.y, 8, font, MUTED)
  c.y -= 10
  rule(c.y)
  c.y -= 14

  // ---- Företag / kund ----
  const block = (x: number, width: number, heading: string, rows: (string | null | undefined)[]) => {
    let y = c.y
    text(heading, x, y, 8, bold, MUTED)
    y -= 12
    for (const r of rows.filter(Boolean) as string[]) {
      for (const l of wrap(font, S(r), 9, width)) {
        text(l, x, y)
        y -= 11
      }
    }
    return y
  }
  const co = snap.company
  const companyRows = [
    co.name as string,
    co.address as string,
    [co.postal_code, co.city].filter(Boolean).join(' '),
    co.organization_number ? `Org.nr ${co.organization_number}` : null,
    co.vat_number ? `Momsreg.nr ${co.vat_number}` : null,
    co.f_skatt ? 'Godkänd för F-skatt' : null,
    co.bankgiro ? `Bankgiro ${co.bankgiro}` : null,
    [co.phone, co.email].filter(Boolean).join(' · '),
  ]
  const cu = snap.customer
  const billingAddr = cu?.billing_address
    ? [cu.billing_address, [cu.billing_postal_code, cu.billing_city].filter(Boolean).join(' ')]
    : [cu?.address, [cu?.postal_code, cu?.city].filter(Boolean).join(' ')]
  const customerRows = cu
    ? [
        cu.name,
        ...billingAddr,
        cu.organization_number ? `Org.nr/pnr ${cu.organization_number}` : null,
        cu.contact_person ? `Kontakt: ${cu.contact_person}` : null,
        [cu.phone || cu.mobile, cu.billing_email || cu.email].filter(Boolean).join(' · '),
        cu.invoice_reference ? `Er referens: ${cu.invoice_reference}` : null,
      ]
    : ['Kund saknas']
  const colW = (W - 20) / 2
  const y1 = block(M, colW, 'FRÅN', companyRows)
  const y2 = block(M + colW + 20, colW, 'KUND / FAKTURAMOTTAGARE', customerRows)
  c.y = Math.min(y1, y2) - 6
  rule(c.y)
  c.y -= 14

  // ---- Projekt / fastighet / del ----
  const pr = snap.project
  const prop = snap.property
  const propRows: string[] = []
  if (prop.property_designation) propRows.push(`Fastighetsbeteckning: ${prop.property_designation}`)
  if (prop.housing_type === 'brf') {
    propRows.push(
      ['Bostadsrätt', prop.brf_name, prop.brf_org_number ? `org.nr ${prop.brf_org_number}` : null, prop.apartment_number ? `lgh ${prop.apartment_number}` : null]
        .filter(Boolean)
        .join(', ')
    )
  } else if (prop.housing_type === 'villa') propRows.push('Bostadstyp: småhus')
  const y3 = block(M, colW, 'PROJEKT', [`${pr.project_number} – ${pr.name}`, pr.site_address ? `Arbetsadress: ${pr.site_address}` : null, ...propRows])
  const pa = snap.part
  const partRows = [
    `${PART_KIND_LABELS[pa.kind]}: ${pa.name}`,
    pa.percent_bp !== null ? `Andel av grundavtalet: ${formatPercentBp(pa.percent_bp)}` : null,
    pa.planned_date || pa.milestone ? `Planerat: ${[pa.planned_date, pa.milestone].filter(Boolean).join(' – ')}` : null,
    pa.ata_reference
      ? `ÄTA-referens: ${pa.ata_reference.description}${pa.ata_reference.date ? ` (${pa.ata_reference.date})` : ''}`
      : null,
    pa.corrects_document_number ? `Korrigerar underlag ${pa.corrects_document_number}` : null,
  ]
  const y4 = block(M + colW + 20, colW, 'FAKTURERINGSDEL', partRows)
  c.y = Math.min(y3, y4) - 8

  // ---- Fakturarader per typ ----
  const cols = {
    desc: M + 4,
    qty: M + W * 0.55,
    unit: M + W * 0.565,
    price: M + W * 0.76,
    vat: M + W * 0.83,
    sum: M + W - 4,
  }
  const drawTableHeader = () => {
    const h = 16
    c.page.drawRectangle({ x: M, y: c.y - h + 4, width: W, height: h, color: HEAD_BG })
    const y = c.y - 7
    text('Beskrivning', cols.desc, y, 8, bold)
    rightText('Antal', cols.qty, y, 8, bold)
    text('Enhet', cols.unit + 4, y, 8, bold)
    rightText('À-pris', cols.price, y, 8, bold)
    rightText('Moms', cols.vat, y, 8, bold)
    rightText('Summa', cols.sum, y, 8, bold)
    c.y -= h + 4
  }
  const fmtQty = (q: string) => q.replace('.', ',')
  const fmtPrice = (p: string) => {
    const v = displayPrice(p, 0, 'ex')
    const [i, f] = v.split('.')
    return `${(i ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${f ?? '00'} kr`
  }

  const groups: LineType[] = ['arbete', 'material', 'ovrigt']
  const groupLabel: Record<LineType, string> = { arbete: 'Arbetskostnad', material: 'Material', ovrigt: 'Övriga kostnader' }
  for (const g of groups) {
    const lines = snap.lines.filter((l) => l.line_type === g)
    if (!lines.length) continue
    ensure(c, 60)
    text(groupLabel[g], M, c.y, 10, bold, PRIMARY)
    rightText('Belopp exkl. moms', M + W, c.y, 8, font, MUTED)
    c.y -= 8
    drawTableHeader()
    c.repeatHeader = () => {
      text(`${groupLabel[g]} (forts.)`, M, c.y, 10, bold, PRIMARY)
      rightText('Belopp exkl. moms', M + W, c.y, 8, font, MUTED)
      c.y -= 8
      drawTableHeader()
    }
    let sub = 0
    for (const l of lines as SnapshotLine[]) {
      const desc = l.description + (l.rot_eligible ? ' (ROT)' : '')
      const dl = wrap(font, S(desc), 9, cols.qty - cols.desc - 45)
      const h = dl.length * 11 + 3
      ensure(c, h)
      let y = c.y - 2
      dl.forEach((t, i) => text(t, cols.desc, y - i * 11))
      rightText(fmtQty(l.quantity), cols.qty, y)
      text(l.unit ?? '', cols.unit + 4, y)
      rightText(fmtPrice(l.unit_price_ex_vat), cols.price, y)
      rightText(formatPercentBp(l.vat_rate_bp), cols.vat, y)
      rightText(formatOre(l.ex_ore), cols.sum, y)
      c.y -= h
      c.page.drawLine({ start: { x: M, y: c.y + 4 }, end: { x: M + W, y: c.y + 4 }, thickness: 0.3, color: RULE })
      sub += l.ex_ore
    }
    c.repeatHeader = null
    ensure(c, 16)
    rightText(`Summa ${LINE_TYPE_LABELS[g].toLowerCase()} exkl. moms`, cols.price, c.y - 4, 9, bold)
    rightText(formatOre(sub), cols.sum, c.y - 4, 9, bold)
    c.y -= 22
  }
  if (!snap.lines.length) {
    text('Inga fakturarader.', M, c.y, 9, font, MUTED)
    c.y -= 18
  }

  // ---- Summering ----
  const s = snap.summary
  const a = s.amounts
  const sumRows: [string, string, boolean?][] = [
    ['Arbetskostnad exkl. moms', formatOre(a.work_ex_ore)],
    ['Material exkl. moms', formatOre(a.material_ex_ore)],
    ['Övriga kostnader exkl. moms', formatOre(a.other_ex_ore)],
    ['Summa exkl. moms', formatOre(a.ex_ore), true],
  ]
  for (const [rate, g] of Object.entries(a.vat_by_rate)) {
    sumRows.push([`Moms ${formatPercentBp(Number(rate))} (på ${formatOre(g.ex_ore)})`, formatOre(g.vat_ore)])
  }
  sumRows.push(['Summa inkl. moms före ROT', formatOre(a.inc_ore), true])
  if (snap.rot.enabled) sumRows.push([`ROT-avdrag (${formatPercentBp(snap.rot.rate_bp)})`, formatOre(-s.rot_total_ore)])
  ensure(c, sumRows.length * 13 + 40)
  rule(c.y + 4)
  c.y -= 6
  const labelX = M + W - 120
  for (const [k, v, strong] of sumRows) {
    rightText(k, labelX, c.y, 9, strong ? bold : font)
    rightText(v, M + W - 4, c.y, 9, strong ? bold : font)
    c.y -= 13
  }
  c.y -= 6
  c.page.drawRectangle({ x: M + W * 0.45, y: c.y - 8, width: W * 0.55, height: 22, color: HEAD_BG })
  rightText('Att betala', labelX, c.y - 1, 11, bold, PRIMARY)
  rightText(formatOre(s.to_pay_ore), M + W - 4, c.y - 1, 11, bold, PRIMARY)
  c.y -= 32

  // ---- ROT ----
  if (snap.rot.enabled) {
    const recips = snap.rot.recipients.filter((r) => r.amount_ore > 0)
    ensure(c, 50 + recips.length * 12)
    text('ROT-avdrag', M, c.y, 10, bold, PRIMARY)
    c.y -= 13
    text(
      `Procentsats ${formatPercentBp(snap.rot.rate_bp)}. Beräknat maximalt ROT för underlaget: ${formatOre(s.max_rot_ore)} (beräkningsstöd – ingen garanti för kundens rätt till ROT).`,
      M,
      c.y,
      8,
      font,
      MUTED
    )
    c.y -= 14
    if (!recips.length) {
      text('Inget ROT-avdrag på detta underlag.', M, c.y, 9)
      c.y -= 12
    }
    for (const r of recips) {
      let pnr = ''
      if (r.personnummer_enc && opts.decryptPnr) pnr = formatPersonnummer(opts.decryptPnr(r.personnummer_enc))
      text(r.name ?? '', M, c.y)
      text(pnr, M + W * 0.45, c.y)
      rightText(formatOre(r.amount_ore), M + W - 4, c.y)
      c.y -= 12
    }
    c.y -= 6
  }

  // ---- Sidfot och utkastmärkning på alla sidor ----
  const pages = doc.getPages()
  pages.forEach((pg, i) => {
    const foot = S(`Faktureringsunderlag ${snap.document_number}${snap.draft ? ' (utkast)' : ''} · ${co.name ?? ''} · Sida ${i + 1} av ${pages.length}`)
    pg.drawLine({ start: { x: M, y: M - 6 }, end: { x: M + W, y: M - 6 }, thickness: 0.5, color: RULE })
    pg.drawText(foot, { x: M, y: M - 18, size: 7.5, font, color: MUTED })
    if (snap.draft) {
      pg.drawText('UTKAST', {
        x: A4[0] / 2 - 160,
        y: A4[1] / 2 - 120,
        size: 110,
        font: bold,
        color: rgb(0.85, 0.1, 0.1),
        opacity: 0.08,
        rotate: degrees(35),
      })
    }
  })

  return doc.save()
}

export function billingPdfFilename(snap: BillingSnapshot): string {
  const base = `Faktureringsunderlag-${snap.document_number}${snap.draft ? '-utkast' : snap.version ? `-v${snap.version}` : ''}`
  return base.replace(/[^A-Za-z0-9._-]+/g, '_') + '.pdf'
}
