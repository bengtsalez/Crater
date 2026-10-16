import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { PDFDocument, PDFRawStream, PDFName } from 'pdf-lib'
import { renderBillingPdf, billingPdfFilename } from './billingPdf'
import type { BillingSnapshot, SnapshotLine } from '../../shared/billingTypes'
import { lineExOre, lineItems, summarize, type LineType } from '../../shared/billing'

// Text i PDF:en ritas med standardfont (WinAnsi) som hex-strängar – avkoda alla
// innehållsströmmar och leta efter den förväntade texten.
async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes)
  const cp1252 = new TextDecoder('windows-1252')
  let out = ''
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    let data = obj.contents
    if (obj.dict.get(PDFName.of('Filter')) === PDFName.of('FlateDecode')) data = inflateSync(data)
    const s = Buffer.from(data).toString('latin1')
    for (const m of s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += cp1252.decode(Buffer.from(m[1]!, 'hex')) + '\n'
    for (const m of s.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out += m[1] + '\n'
  }
  return out
}

function snapshot(lineCount: number, draft: boolean): BillingSnapshot {
  const types: LineType[] = ['arbete', 'material', 'ovrigt']
  const lines: SnapshotLine[] = Array.from({ length: lineCount }, (_, i) => {
    const l = {
      description: `Rad ${i + 1}: grävning, dränering och återfyllnad vid förrådet – ÅÄÖ åäö é ${'lång text '.repeat(i % 3 === 0 ? 8 : 1)}`,
      line_type: types[i % 3]!,
      quantity: String(1 + (i % 7) / 2),
      unit: ['tim', 'm²', 'm³'][i % 3]!,
      unit_price_ex_vat: String(100 + i),
      vat_rate_bp: 2500,
      rot_eligible: i % 3 === 0,
    }
    return { ...l, ex_ore: lineExOre(l)! }
  })
  const amounts = summarize(lineItems(lines))
  return {
    format: 1,
    draft,
    version: draft ? null : 1,
    document_number: 'FU-1042-03',
    document_date: '2026-10-14',
    company: { name: 'Byggproffs Skåne AB', organization_number: '556677-8899', vat_number: 'SE556677889901', address: 'Byggvägen 1', postal_code: '22100', city: 'Lund', email: 'info@bygg.se', phone: '046-123', bankgiro: '123-4567', f_skatt: true },
    customer: { name: 'Åsa Öberg', organization_number: null, contact_person: null, email: 'asa@x.se', phone: '070-1', mobile: null, address: 'Ängsvägen 4', postal_code: '22222', city: 'Höör', billing_address: null, billing_postal_code: null, billing_city: null, billing_email: null, invoice_reference: null },
    project: { project_number: '1042', name: 'Dränering villa Öberg', site_address: 'Ängsvägen 4, Höör' },
    property: { property_designation: 'Höör Smörblomman 7', housing_type: 'villa', brf_name: null, brf_org_number: null, apartment_number: null },
    part: { kind: 'installment', name: 'Efter dränering', percent_bp: 4000, planned_date: '2026-11-01', milestone: 'Dränering klar', ata_reference: null, corrects_document_number: null },
    lines,
    summary: { amounts, target_inc_ore: amounts.inc_ore, max_rot_ore: 12000_00, rot_total_ore: 12000_00, to_pay_ore: amounts.inc_ore - 12000_00 },
    rot: {
      enabled: true,
      rate_bp: 3000,
      recipients: [
        { name: 'Åsa Öberg', personnummer_enc: 'ENC', amount_ore: 12000_00 },
        { name: 'Oanvänd Person', personnummer_enc: null, amount_ore: 0 },
      ],
    },
    invoiced_date: draft ? null : '2026-10-14',
    external_invoice_ref: draft ? null : '10045',
  }
}

describe('renderBillingPdf', () => {
  it('många rader → flera A4-sidor, svenska tecken och upprepade tabellrubriker', async () => {
    const bytes = await renderBillingPdf(snapshot(150, false), { decryptPnr: () => '198112189876' })
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThan(3)
    const { width, height } = pdf.getPage(0).getSize()
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842])
    const t = await pdfText(bytes)
    expect(t).toContain('Faktureringsunderlag')
    expect(t).not.toContain('UTKAST')
    expect(t).toContain('FU-1042-03')
    expect(t).toContain('Höör Smörblomman 7')
    expect(t).toContain('grävning, dränering och återfyllnad vid förrådet')
    expect(t.replace(/\n/g, ' ')).toContain('ÅÄÖ åäö é')
    expect(t).toContain('Fortnox fakturanr:')
    expect(t).toContain('10045')
    expect(t).toContain('Andel av grundavtalet: 40 %')
    expect(t).toContain('Arbetskostnad (forts.)') // rubrik upprepas efter sidbrytning
    expect((t.match(/Belopp exkl. moms/g) || []).length).toBeGreaterThan(3)
    expect(t).toContain('Att betala')
    expect(t).toContain('19811218-9876')
    expect(t).not.toContain('Oanvänd Person') // ROT-person med 0 kr utelämnas
    expect(t).toMatch(/Sida 1 av \d+/)
  })

  it('utkast märks tydligt', async () => {
    const snap = snapshot(3, true)
    const t = await pdfText(await renderBillingPdf(snap))
    expect(t).toContain('Faktureringsunderlag – UTKAST')
    expect(t).toContain('UTKAST')
    expect(billingPdfFilename(snap)).toBe('Faktureringsunderlag-FU-1042-03-utkast.pdf')
  })

  it('tecken utanför teckenuppsättningen kraschar inte', async () => {
    const snap = snapshot(1, true)
    snap.lines[0]!.description = 'Emoji 🚧 och minus − och ł'
    await expect(renderBillingPdf(snap)).resolves.toBeInstanceOf(Uint8Array)
  })
})
