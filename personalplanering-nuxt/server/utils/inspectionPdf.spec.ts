import { describe, expect, it } from 'vitest'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { renderFinalProtocol, renderInspectionPdf, inspectionPdfFilename, protocolIsComplete } from './inspectionPdf'
import { sniffImage } from './inspectionImages'
import { coverage, evaluateItem, EMPTY_ANSWER, type InspectionStatus } from '../../shared/inspections'
import type { InspectionSnapshot, SnapshotItem } from '../../shared/inspectionTypes'
import { fakeJpeg } from '../../test/memoryStorage'

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes)
  const cp1252 = new TextDecoder('windows-1252')
  let out = ''
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    if (obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) continue
    let data = obj.contents
    if (obj.dict.get(PDFName.of('Filter')) === PDFName.of('FlateDecode')) data = inflateSync(data)
    const s = Buffer.from(data).toString('latin1')
    for (const m of s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += cp1252.decode(Buffer.from(m[1]!, 'hex')) + '\n'
  }
  return out
}

function png(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2 // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x80)
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0
  return new Uint8Array(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  )
}

const IMAGES: Record<string, Uint8Array> = {
  'k/portrait-exif6.jpg': fakeJpeg(800, 600, 6), // lagrad liggande, visas stående
  'k/portrait.png': png(30, 60),
}

function snapshot(itemCount: number, status: InspectionStatus): InspectionSnapshot {
  const items: SnapshotItem[] = Array.from({ length: itemCount }, (_, i) => {
    const answer = {
      ...EMPTY_ANSWER,
      result: i % 5 === 0 ? ('deviation' as const) : ('ok' as const),
      comment: `Kommentar ${i}: grävning vid förrådet – ÅÄÖ åäö é ${'lång text '.repeat(i % 4 === 0 ? 30 : 1)}`,
    }
    const it = {
      answer_type: 'result' as const,
      required: true,
      min_photos: i < 2 ? 1 : 0,
      comment_required: false,
    }
    return {
      id: i + 1,
      item_key: `k${i}`,
      section_title: i < itemCount / 2 ? 'Före återfyllning' : 'Återställning',
      sort_order: i,
      title: `Kontrollpunkt ${i + 1} – fall på dräneringsledning`,
      instruction: 'Kontrollera mot ritning A-101.',
      basis: 'Ritning A-101',
      basis_url: 'https://exempel.invalid/ritning.pdf',
      method: 'Visuell kontroll',
      unit: null,
      critical: i === 1,
      timing_note: i === 1 ? 'Innan återfyllning' : null,
      ...it,
      answer: { ...answer, answered_by_name: 'anna', answered_at: '2026-10-16T08:00:00Z', rev: 1 },
      photos:
        i === 0
          ? [{ id: 'p1', storage_key: 'k/portrait-exif6.jpg', content_type: 'image/jpeg', width: 800, height: 600, exif_orientation: 6 }]
          : i === 1
            ? [
                { id: 'p2', storage_key: 'k/portrait.png', content_type: 'image/png', width: 30, height: 60, exif_orientation: null },
                { id: 'p3', storage_key: 'k/saknas.webp', content_type: 'image/webp', width: 10, height: 10, exif_orientation: null },
              ]
            : [],
      evaluation: evaluateItem(it, answer, i < 2 ? 1 : 0),
    }
  })
  return {
    schema: 1,
    org: { name: 'Byggproffs Åkesson AB' },
    project: { id: 1, project_number: 'P1115', name: 'Dränering Ängsvägen', site_address: 'Ängsvägen 3, Lund', customer_name: 'Örjan Älv', work_type: 'project' },
    inspection: {
      id: 9,
      name: 'Dränering',
      kind: 'self_inspection',
      description: null,
      location: 'Norrsida',
      due_date: '2026-10-30',
      responsible_user_id: 2,
      responsible_name: 'anna',
      status,
      revision: 2,
      previous_inspection_id: 8,
      superseded_by_id: null,
      revision_reason: 'Rättat mätvärde',
      lock_version: 3,
      template_id: 1,
      template_version: 3,
      started_at: null,
      submitted_at: '2026-10-16T09:00:00Z',
      submitted_by_name: 'anna',
      review_comment: null,
      approved_at: status === 'approved' ? '2026-10-16T10:00:00Z' : null,
      approved_by_name: status === 'approved' ? 'pm' : null,
      approval_comment: null,
      template_name: 'Dränering',
    },
    items,
    deviations: [
      {
        id: 1, inspection_id: 9, item_id: 1, item_title: 'Kontrollpunkt 1', project_id: 1, description: 'Ledning ligger för högt',
        responsible_user_id: 2, responsible_name: 'anna', due_date: '2026-10-20', action_description: 'Ledningen sänktes',
        status: 'verified', reported_by_name: 'anna', created_at: '2026-10-16T08:00:00Z', resolved_by_name: 'anna',
        resolved_at: '2026-10-16T08:30:00Z', verified_by_name: 'pm', verified_at: '2026-10-16T09:30:00Z', reopen_reason: null,
        task_id: null, rev: 3, photos: [],
      },
    ],
    events: [
      { id: 1, event_type: 'submitted', from_status: 'in_progress', to_status: 'submitted', comment: null, user_name: 'anna', created_at: '2026-10-16T09:00:00Z' },
    ],
    coverage: coverage(items),
    generated_at: '2026-10-16T10:00:00Z',
  }
}

const loadImage = async (k: string) => IMAGES[k] ?? null

describe('kontroll-PDF', () => {
  it('A4, flera sidor, svenska tecken, sidnumrering och bilder', async () => {
    const bytes = await renderInspectionPdf(snapshot(40, 'approved'), { loadImage })
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThan(2)
    for (const p of pdf.getPages()) expect(p.getSize()).toEqual({ width: 595.28, height: 841.89 })
    const text = await pdfText(bytes)
    expect(text).toContain('Egenkontroll: Dränering')
    expect(text).toContain('ÅÄÖ åäö é')
    expect(text).toContain('Örjan Älv')
    expect(text).toContain(`Sida 1 av ${pdf.getPageCount()}`)
    expect(text).toContain('Status: Godkänd')
    expect(text).toContain('Bild i WebP-format')
    expect(text).not.toContain('EJ GODKÄND')
    // Länken skrivs bara ut som text.
    expect(text).toContain('https://exempel.invalid/ritning.pdf')
    const images = [...pdf.context.enumerateIndirectObjects()].filter(
      ([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
    )
    expect(images.length).toBe(2)
  })

  it('ej godkänd kontroll märks med faktisk status', async () => {
    const text = await pdfText(await renderInspectionPdf(snapshot(3, 'in_progress'), { loadImage }))
    expect(text).toContain('EJ GODKÄND – PÅGÅR')
    expect(text).toContain('Kontrollen är inte godkänd.')
  })

  it('porträttbild med EXIF-orientering ritas stående och inom sidan', async () => {
    const bytes = await renderInspectionPdf(snapshot(1, 'approved'), { loadImage })
    const pdf = await PDFDocument.load(bytes)
    let content = ''
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Filter')) === PDFName.of('FlateDecode') && !obj.dict.get(PDFName.of('Subtype'))) {
        content += Buffer.from(inflateSync(obj.contents)).toString('latin1')
      }
    }
    // pdf-lib skriver: translate-cm, rotate-cm, scale-cm, … /Image Do. Räkna ut
    // bildens faktiska ruta på sidan och kontrollera att den är stående och inom marginalerna.
    const blocks = [...content.matchAll(/q\n((?:[-\d.e]+ ){6}cm\n)+\/Image-?\d+ Do/g)].map((m) => m[0])
    expect(blocks.length).toBe(1)
    const mats = [...blocks[0]!.matchAll(/((?:[-\d.e]+ ){6})cm/g)].map((m) => m[1]!.trim().split(' ').map(Number))
    const mul = (m: number[], n: number[]) => [
      m[0]! * n[0]! + m[2]! * n[1]!, m[1]! * n[0]! + m[3]! * n[1]!,
      m[0]! * n[2]! + m[2]! * n[3]!, m[1]! * n[2]! + m[3]! * n[3]!,
      m[0]! * n[4]! + m[2]! * n[5]! + m[4]!, m[1]! * n[4]! + m[3]! * n[5]! + m[5]!,
    ]
    const t = mats.reduce((acc, m) => mul(acc, m), [1, 0, 0, 1, 0, 0])
    const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => [t[0]! * u! + t[2]! * v! + t[4]!, t[1]! * u! + t[3]! * v! + t[5]!])
    const xs = pts.map((p) => p[0]!)
    const ys = pts.map((p) => p[1]!)
    const [w, h] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
    expect(h).toBeGreaterThan(w) // stående
    expect(h / w).toBeCloseTo(800 / 600, 2)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(42 - 0.01)
    expect(Math.max(...xs)).toBeLessThanOrEqual(595.28 - 42 + 0.01)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(42)
    expect(Math.max(...ys)).toBeLessThanOrEqual(841.89 - 42)
  })

  it('filnamn är ASCII och visar status', () => {
    expect(inspectionPdfFilename(snapshot(1, 'approved'))).toBe('Egenkontroll-P1115-Dranering-Norrsida-rev2.pdf')
    expect(inspectionPdfFilename(snapshot(1, 'submitted'))).toBe('Egenkontroll-P1115-Dranering-Norrsida-rev2-submitted.pdf')
  })
})

describe('slutprotokoll', () => {
  const base = {
    org: { name: 'Byggproffs' },
    project: snapshot(1, 'approved').project,
    generated_at: '2026-10-16T10:00:00Z',
  }

  it('ofullständigt protokoll redovisar kvarstående kontroller och avvikelser', async () => {
    const snap = snapshot(2, 'approved')
    const input = {
      ...base,
      inspections: [
        { name: 'Dränering', kind: 'self_inspection' as const, location: 'Norrsida', status: 'approved' as const, revision: 2, coverage: snap.coverage, open_deviations: 0 },
        { name: 'Fasad', kind: 'self_inspection' as const, location: 'Södersida', status: 'in_progress' as const, revision: 1, coverage: snap.coverage, open_deviations: 1 },
      ],
      approved: [snap],
      open_deviations: [
        { inspection_name: 'Fasad', location: 'Södersida', item_title: 'Anslutning fönster', description: 'Springa vid fönsterbleck', status: 'open' as const, responsible_name: 'bo', due_date: '2026-10-25' },
      ],
    }
    expect(protocolIsComplete(input)).toBe(false)
    const text = await pdfText(await renderFinalProtocol(input, { loadImage }))
    expect(text).toContain('Ofullständigt slutprotokoll – egenkontroller')
    expect(text).toContain('1 av 2 kontroller är godkända')
    expect(text).toContain('Kvarstående avvikelser (1)')
    expect(text).toContain('Springa vid fönsterbleck')
    expect(text).toContain('OFULLSTÄNDIGT')
  })

  it('projekt utan kontroller ger aldrig ett fullständigt protokoll', async () => {
    const input = { ...base, inspections: [], approved: [], open_deviations: [] }
    expect(protocolIsComplete(input)).toBe(false)
    const text = await pdfText(await renderFinalProtocol(input))
    expect(text).toContain('Inga egenkontroller eller checklistor har lagts till')
  })

  it('fullständigt protokoll när allt är godkänt', async () => {
    const snap = snapshot(2, 'approved')
    const input = {
      ...base,
      inspections: [{ name: 'Dränering', kind: 'self_inspection' as const, location: null, status: 'approved' as const, revision: 1, coverage: snap.coverage, open_deviations: 0 }],
      approved: [snap],
      open_deviations: [],
    }
    const text = await pdfText(await renderFinalProtocol(input, { loadImage }))
    expect(text).toContain('Slutprotokoll – egenkontroller')
    expect(text).not.toContain('Ofullständigt')
  })
})

describe('sniffImage', () => {
  it('känner igen JPEG (med mått och EXIF-orientering), PNG och WebP', () => {
    expect(sniffImage(fakeJpeg(800, 600, 6))).toEqual({ type: 'image/jpeg', width: 800, height: 600, orientation: 6 })
    expect(sniffImage(png(30, 60))).toEqual({ type: 'image/png', width: 30, height: 60, orientation: null })
    const webp = new Uint8Array(30)
    webp.set(Buffer.from('RIFF\0\0\0\0WEBPVP8X'), 0)
    webp.set([0x1f, 0x03, 0x00, 0x57, 0x04, 0x00], 24) // 800 x 1112
    expect(sniffImage(webp)).toEqual({ type: 'image/webp', width: 800, height: 1112, orientation: null })
  })

  it('avvisar annat än bilder även om filnamn/typ påstår annat', () => {
    expect(sniffImage(new TextEncoder().encode('%PDF-1.7'))).toBeNull()
    expect(sniffImage(new TextEncoder().encode('GIF89a......'))).toBeNull()
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })
})
