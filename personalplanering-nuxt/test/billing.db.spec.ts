import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { createTestDb, type TestDb } from './pgliteDb'
import { seed } from './seed'
import {
  acknowledgeAtaChange,
  createCorrection,
  deletePart,
  getPartRecipientsPlain,
  getPartSnapshot,
  getProjectBilling,
  importAta,
  listAtaCandidates,
  recordPayments,
  saveAllocations,
  saveBaseLines,
  saveInstallments,
  setPartStatus,
  updateBillingSettings,
  updatePart,
} from '../server/utils/billing'
import { decryptPnr, BillingError } from '../server/utils/billingCrypto'
import { renderBillingPdf } from '../server/utils/billingPdf'

// Fakturering mot riktig Postgres (PGlite) med appens fullständiga schema.
process.env.BILLING_ENCRYPTION_KEY = randomBytes(32).toString('base64')
const TODAY = '2026-10-14'
const KR = (n: number) => n * 100
let db: TestDb
let s: Awaited<ReturnType<typeof seed>>
let ctx: { orgId: number; userId: number }

async function ata(org: number, project: number, description: string, amount: number, status = 'godkand') {
  const r = await db.query(
    "INSERT INTO project_line_items (org_id, project_id, type, description, amount, date, ata_status) VALUES ($1,$2,'ata',$3,$4,'2026-10-01',$5) RETURNING id",
    [org, project, description, amount, status]
  )
  return Number(r.rows[0].id)
}

async function expectError(p: Promise<unknown>, status: number, re?: RegExp) {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(BillingError)
    expect((e as BillingError).status).toBe(status)
    if (re) expect((e as Error).message).toMatch(re)
    return
  }
  throw new Error('förväntade fel')
}

beforeAll(async () => {
  db = await createTestDb()
  s = await seed(db, TODAY)
  ctx = { orgId: s.orgA, userId: s.pm }
  await db.query(
    "UPDATE organizations SET organization_number='556677-8899', address='Byggvägen 1', postal_code='22100', city='Lund', bankgiro='123-4567', f_skatt=true WHERE id=$1",
    [s.orgA]
  )
}, 60000)
afterAll(() => db.close())

describe('acceptansflöde: grundavtal 200 000 kr, 30/40/30', () => {
  it('sparar grundavtal, rader och plan; ROT är 0 tills det fylls i', async () => {
    await updateBillingSettings(db, ctx, s.p1, {
      rot_enabled: true,
      rot_rate: '30',
      property_designation: 'Lund Påskliljan 3',
      housing_type: 'villa',
    })
    await saveBaseLines(db, ctx, s.p1, [
      { description: 'Schakt och dränering – arbete', line_type: 'arbete', quantity: '100', unit: 'tim', unit_price_ex_vat: '800', vat_rate_bp: 2500, rot_eligible: true },
      { description: 'Material (dränrör, makadam, duk)', line_type: 'material', quantity: '1', unit: 'st', unit_price_ex_vat: '80000', vat_rate_bp: 2500, rot_eligible: false },
    ])
    // Grundavtalets totalsumma räknas fram ur posterna.
    expect((await getProjectBilling(db, s.orgA, s.p1))!.settings.base_total_inc_ore).toBe(KR(200000))
    await saveInstallments(db, ctx, s.p1, [
      { name: 'Efter schakt', percent: '30', milestone: 'Schakt klar' },
      { name: 'Efter dränering', percent: '40' },
      { name: 'Efter återställning', percent: '30' },
    ])
    const v0 = (await getProjectBilling(db, s.orgA, s.p1))!
    // Planen sparas om utan milstolpe → befintlig milstolpe behålls.
    await saveInstallments(db, ctx, s.p1, v0.parts.map((p) => ({ id: p.id, name: p.name, percent: String(p.percent_bp! / 100) })))
    const v = (await getProjectBilling(db, s.orgA, s.p1))!
    expect(v.parts[0]!.milestone).toBe('Schakt klar')
    expect(v.calc.base.inc_ore).toBe(KR(200000))
    expect(v.calc.base_errors).toEqual([])
    const parts = v.parts.filter((p) => p.kind === 'installment')
    expect(parts.map((p) => v.calc.parts[p.id]!.amounts.inc_ore)).toEqual([KR(60000), KR(80000), KR(60000)])
    expect(parts.map((p) => v.calc.parts[p.id]!.max_rot_ore)).toEqual([KR(9000), KR(12000), KR(9000)])
    expect(parts.flatMap((p) => p.rot_recipients.map((r) => r.amount_ore))).toEqual([0, 0, 0, 0, 0, 0])
    expect(parts.map((p) => p.document_number)).toEqual(['FU-P1-01', 'FU-P1-02', 'FU-P1-03'])
  })

  it('manuellt ROT ger 51 000 / 68 000 / 51 000 – personnummer lagras krypterat', async () => {
    const v = (await getProjectBilling(db, s.orgA, s.p1))!
    const parts = v.parts.filter((p) => p.kind === 'installment')
    const rot = ['9000', '12000', '9000']
    for (const [i, p] of parts.entries()) {
      await updatePart(db, ctx, p.id, {
        rot_recipients: [
          { position: 1, name: 'Åsa Öberg', personnummer: '811218-9876', amount: rot[i] },
          { position: 2, name: '', personnummer: '', amount: '0' },
        ],
      })
    }
    const v2 = (await getProjectBilling(db, s.orgA, s.p1))!
    expect(parts.map((p) => v2.calc.parts[p.id]!.to_pay_ore)).toEqual([KR(51000), KR(68000), KR(51000)])
    expect(parts.map((p) => v2.calc.parts[p.id]!.amounts.vat_ore)).toEqual([KR(12000), KR(16000), KR(12000)])
    expect(JSON.stringify(v2)).not.toMatch(/811218|198112/)
    expect(v2.parts[0]!.rot_recipients[0]!.personnummer_masked).toBe('********-9876')
    const { rows } = await db.query('SELECT personnummer_enc, personnummer_last4 FROM billing_rot_recipients WHERE personnummer_enc IS NOT NULL')
    expect(rows.length).toBe(3)
    for (const r of rows) {
      expect(r.personnummer_enc).not.toMatch(/811218|198112/)
      expect(decryptPnr(r.personnummer_enc)).toBe('198112189876')
    }
    const plain = await getPartRecipientsPlain(db, s.orgA, parts[0]!.id, decryptPnr)
    expect(plain![0]).toMatchObject({ name: 'Åsa Öberg', personnummer: '198112189876', amount_ore: KR(9000) })
  })

  it('ogiltigt personnummer och negativt ROT avvisas', async () => {
    const v = (await getProjectBilling(db, s.orgA, s.p1))!
    const id = v.parts[0]!.id
    await expectError(updatePart(db, ctx, id, { rot_recipients: [{ position: 1, name: 'X', personnummer: '811218-9875' }] }), 400, /personnummer/)
    await expectError(updatePart(db, ctx, id, { rot_recipients: [{ position: 2, name: 'X', amount: '-5' }] }), 400, /negativt/)
  })

  it('fakturerad del låses och sparar en oföränderlig version', async () => {
    const v = (await getProjectBilling(db, s.orgA, s.p1))!
    const first = v.parts[0]!
    await expectError(setPartStatus(db, ctx, first.id, { status: 'fakturerad' }), 409)
    await setPartStatus(db, ctx, first.id, { status: 'klar' })
    await setPartStatus(db, ctx, first.id, { status: 'fakturerad', external_invoice_ref: '10045' }, TODAY)
    const v2 = (await getProjectBilling(db, s.orgA, s.p1))!
    const p = v2.parts.find((x) => x.id === first.id)!
    expect(p.locked).toBe(true)
    expect(p.documents.length).toBe(1)
    expect(p.invoiced_date).toBe(TODAY)

    // Låst: inga ekonomiska ändringar.
    await expectError(updatePart(db, ctx, first.id, { rot_recipients: [{ position: 1, amount: '1' }] }), 409, /korrigering/)
    await expectError(
      saveBaseLines(db, ctx, s.p1, v2.base_lines.map((l, i) => ({ ...l, unit_price_ex_vat: i === 0 ? '801' : l.unit_price_ex_vat }))),
      409
    )
    await expectError(
      saveInstallments(db, ctx, s.p1, [
        { id: first.id, name: 'Efter schakt', percent: '25' },
        { id: v2.parts[1]!.id, name: 'Efter dränering', percent: '45' },
        { id: v2.parts[2]!.id, name: 'Efter återställning', percent: '30' },
      ]),
      409
    )
    // Fält som inte påverkar beloppet får ändras.
    await updatePart(db, ctx, first.id, { notes: 'Skickad via Fortnox' })

    // Databasen stoppar UPDATE av en sparad version.
    await expect(db.query("UPDATE billing_documents SET document_number = 'X'")).rejects.toThrow(/oföränderliga/)
  })

  it('PDF för låst del använder sparade uppgifter även om kund och projekt ändras', async () => {
    const v = (await getProjectBilling(db, s.orgA, s.p1))!
    const first = v.parts[0]!
    const before = (await getPartSnapshot(db, s.orgA, first.id))!
    expect(before.draft).toBe(false)
    expect(before.customer!.name).toBe('Kund AB')
    await db.query("UPDATE customers SET name = 'Nytt Namn AB', billing_address = 'Ny väg 9' WHERE id = $1", [s.cust])
    await db.query("UPDATE projects SET name = 'Omdöpt' WHERE id = $1", [s.p1])
    const after = (await getPartSnapshot(db, s.orgA, first.id))!
    expect(after.customer!.name).toBe('Kund AB')
    expect(after.project.name).toBe('Projekt P1')
    expect(after.summary.to_pay_ore).toBe(KR(51000))
    expect(after.external_invoice_ref).toBe('10045')
    // Utkast för öppen del speglar aktuella uppgifter.
    const draft = (await getPartSnapshot(db, s.orgA, v.parts[1]!.id, { today: TODAY }))!
    expect(draft.draft).toBe(true)
    expect(draft.customer!.name).toBe('Nytt Namn AB')
    const bytes = await renderBillingPdf(after, { decryptPnr })
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1)
  })

  it('återstående plan kan ändras utan att låst belopp rörs', async () => {
    const v = (await getProjectBilling(db, s.orgA, s.p1))!
    const [a, b, c] = v.parts.filter((p) => p.kind === 'installment')
    await saveInstallments(db, ctx, s.p1, [
      { id: a!.id, name: a!.name, percent: '30' },
      { id: b!.id, name: b!.name, percent: '50' },
      { id: c!.id, name: c!.name, percent: '20' },
    ])
    const v2 = (await getProjectBilling(db, s.orgA, s.p1))!
    expect(v2.calc.parts[a!.id]!.amounts.inc_ore).toBe(KR(60000))
    expect(v2.calc.parts[b!.id]!.amounts.inc_ore).toBe(KR(100000))
    expect(v2.calc.parts[c!.id]!.amounts.inc_ore).toBe(KR(40000))
    // ROT ändras aldrig automatiskt – del 3 har nu 12 000 > max 6 000 och flaggas.
    expect(v2.calc.parts[c!.id]!.errors.join()).toMatch(/överstiger/)
    expect(v2.calc.parts[b!.id]!.rot_total_ore).toBe(KR(12000))
  })

  it('manuell fördelning valideras mot dubbelfördelning', async () => {
    const v = (await getProjectBilling(db, s.orgA, s.p1))!
    const [a, b] = v.parts.filter((p) => p.kind === 'installment')
    await expectError(saveAllocations(db, ctx, s.p1, [{ part_id: a!.id, line_id: v.base_lines[0]!.id, amount_ex_ore: 1 }]), 409)
    const open = v.allocations.filter((x) => x.part_id !== a!.id)
    const tweaked = open.map((x) => (x.part_id === b!.id && x.line_id === v.base_lines[0]!.id ? { ...x, amount_ex_ore: x.amount_ex_ore + 100 } : x))
    await saveAllocations(db, ctx, s.p1, tweaked)
    const v2 = (await getProjectBilling(db, s.orgA, s.p1))!
    expect(v2.calc.base_errors.join()).toMatch(/överfördelad/)
    await expectError(setPartStatus(db, ctx, b!.id, { status: 'klar' }), 400, /överfördelad/)
    await saveAllocations(db, ctx, s.p1, open)
  })

  it('kundbetalning och ROT följs separat', async () => {
    const v = (await getProjectBilling(db, s.orgA, s.p1))!
    const first = v.parts[0]!
    await expectError(recordPayments(db, ctx, v.parts[1]!.id, { customer_paid: '1' }), 400)
    await recordPayments(db, ctx, first.id, {
      customer_paid: '51000',
      customer_paid_date: '2026-10-20',
      rot_status: 'sokt',
      rot_applied: '9000',
      rot_paid: '4000',
    })
    await setPartStatus(db, ctx, first.id, { status: 'betald' })
    const v2 = (await getProjectBilling(db, s.orgA, s.p1))!
    const ov = v2.calc.overview
    expect(ov.invoiced_inc_ore).toBe(KR(60000))
    expect(ov.remaining_inc_ore).toBe(KR(140000))
    expect(ov.customer_paid_ore).toBe(KR(51000))
    expect(ov.customer_outstanding_ore).toBe(0)
    expect(ov.rot_applied_ore).toBe(KR(9000))
    expect(ov.rot_paid_ore).toBe(KR(4000))
    expect(ov.rot_outstanding_ore).toBe(KR(5000))
    // Underlaget är oförändrat.
    expect(v2.calc.parts[first.id]!.to_pay_ore).toBe(KR(51000))
  })

  it('korrigering kopplas till originalet', async () => {
    const v = (await getProjectBilling(db, s.orgA, s.p1))!
    await expectError(createCorrection(db, ctx, v.parts[1]!.id), 400)
    const { id } = await createCorrection(db, ctx, v.parts[0]!.id)
    await updatePart(db, ctx, id, {
      lines: [{ description: 'Kreditering felaktig mängd', line_type: 'material', quantity: '-1', unit: 'st', unit_price_ex_vat: '1000', vat_rate_bp: 2500 }],
    })
    const v2 = (await getProjectBilling(db, s.orgA, s.p1))!
    const corr = v2.parts.find((p) => p.id === id)!
    expect(corr.corrects_document_number).toBe('FU-P1-01')
    expect(v2.calc.parts[id]!.amounts.inc_ore).toBe(-KR(1250))
    expect(v2.calc.overview.correction_inc_ore).toBe(-KR(1250))
  })
})

describe('ÄTA', () => {
  let approved: number, draftAta: number, other: number
  beforeAll(async () => {
    approved = await ata(s.orgA, s.p1, 'Extra brunn', 12500)
    draftAta = await ata(s.orgA, s.p1, 'Ej godkänd', 5000, 'utkast')
    other = await ata(s.orgB, s.p3, 'Annan org', 777)
  })

  it('bara godkända ÄTA kan hämtas', async () => {
    await expectError(importAta(db, ctx, s.p1, [draftAta]), 400, /godkända/)
    await expectError(importAta(db, ctx, s.p1, [other]), 404)
    const list = (await listAtaCandidates(db, s.orgA, s.p1))!
    expect(list.find((x) => x.id === draftAta)!.ata_status).toBe('utkast')
  })

  it('samtidig hämtning skapar exakt en del', async () => {
    const results = await Promise.allSettled([importAta(db, ctx, s.p1, [approved]), importAta(db, ctx, s.p1, [approved])])
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1)
    const rej = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect((rej.reason as BillingError).status).toBe(409)
    const { rows } = await db.query("SELECT count(*)::int AS n FROM billing_parts WHERE kind='ata' AND ata_line_item_id = $1", [approved])
    expect(rows[0].n).toBe(1)
    // Databasen stoppar även en direkt dubblett.
    await expect(
      db.query(
        "INSERT INTO billing_parts (org_id, project_id, kind, name, document_number, ata_line_item_id) VALUES ($1,$2,'ata','x','DUP-1',$3)",
        [s.orgA, s.p1, approved]
      )
    ).rejects.toThrow()
    const list = (await listAtaCandidates(db, s.orgA, s.p1))!
    expect(list.find((x) => x.id === approved)!.part_id).not.toBeNull()
  })

  it('ÄTA med bara totalbelopp kräver specifikation; ROT gissas inte', async () => {
    const v = (await getProjectBilling(db, s.orgA, s.p1))!
    const part = v.parts.find((p) => p.kind === 'ata')!
    expect(part.lines).toEqual([])
    expect(part.ata!.source).toMatchObject({ description: 'Extra brunn', amount: 12500 })
    expect(v.calc.parts[part.id]!.errors.join()).toMatch(/komplettera specifikationen/)
    await expectError(setPartStatus(db, ctx, part.id, { status: 'klar' }), 400)
    await updatePart(db, ctx, part.id, {
      lines: [
        { description: 'Arbete brunn', line_type: 'arbete', quantity: '5', unit: 'tim', unit_price_ex_vat: '600', rot_eligible: true },
        { description: 'Brunn 400 mm', line_type: 'material', quantity: '1', unit: 'st', unit_price_ex_vat: '7000' },
      ],
    })
    const v2 = (await getProjectBilling(db, s.orgA, s.p1))!
    const r = v2.calc.parts[part.id]!
    expect(r.errors).toEqual([])
    expect(r.amounts.inc_ore).toBe(KR(12500))
    expect(r.max_rot_ore).toBe(KR(1125))
    expect(r.rot_total_ore).toBe(0)
    // Grundavtalets procentfördelning påverkas inte.
    expect(v2.calc.overview.base_total_inc_ore).toBe(KR(200000))
    expect(v2.calc.overview.ata_inc_ore).toBe(KR(12500))
  })

  it('ändrad källpost ger avvikelse på öppen del, men inte på fakturerad', async () => {
    await db.query("UPDATE project_line_items SET amount = 13000, revision = revision + 1 WHERE id = $1", [approved])
    let v = (await getProjectBilling(db, s.orgA, s.p1))!
    const part = v.parts.find((p) => p.kind === 'ata')!
    expect(part.ata!.deviation).toBe(true)
    expect(v.calc.parts[part.id]!.errors.join()).toMatch(/ändrats/)
    await acknowledgeAtaChange(db, ctx, part.id)
    v = (await getProjectBilling(db, s.orgA, s.p1))!
    expect(v.parts.find((p) => p.id === part.id)!.ata!.deviation).toBe(false)
    await setPartStatus(db, ctx, part.id, { status: 'klar' })
    await setPartStatus(db, ctx, part.id, { status: 'fakturerad' })
    await db.query("UPDATE project_line_items SET amount = 99999, revision = revision + 1 WHERE id = $1", [approved])
    v = (await getProjectBilling(db, s.orgA, s.p1))!
    const locked = v.parts.find((p) => p.id === part.id)!
    expect(locked.ata!.deviation).toBe(false)
    expect(v.calc.parts[part.id]!.amounts.inc_ore).toBe(KR(12500))
    const snap = (await getPartSnapshot(db, s.orgA, part.id))!
    expect(snap.part.ata_reference!.amount).toBe(13000)
    await expectError(deletePart(db, ctx, part.id), 409)
  })
})

describe('separation mellan organisationer', () => {
  it('annan org ser inget och kan inte ändra något', async () => {
    const ctxB = { orgId: s.orgB, userId: s.carl }
    expect(await getProjectBilling(db, s.orgB, s.p1)).toBeNull()
    expect(await getProjectBilling(db, s.orgA, s.p3)).toBeNull()
    expect(await listAtaCandidates(db, s.orgB, s.p1)).toBeNull()
    const v = (await getProjectBilling(db, s.orgA, s.p1))!
    const partId = v.parts[0]!.id
    expect(await getPartSnapshot(db, s.orgB, partId)).toBeNull()
    expect(await getPartRecipientsPlain(db, s.orgB, partId, decryptPnr)).toBeNull()
    await expectError(updateBillingSettings(db, ctxB, s.p1, { base_total_inc: '1' }), 404)
    await expectError(saveBaseLines(db, ctxB, s.p1, []), 404)
    await expectError(updatePart(db, ctxB, partId, { notes: 'x' }), 404)
    await expectError(setPartStatus(db, ctxB, partId, { status: 'betald' }), 404)
    await expectError(recordPayments(db, ctxB, partId, { customer_paid: '1' }), 404)
    await expectError(createCorrection(db, ctxB, partId), 404)
    await expectError(importAta(db, ctxB, s.p1, [1]), 404)
    expect(await getProjectBilling(db, s.orgA, Number('abc'))).toBeNull()
  })
})

describe('aktivitetslogg', () => {
  it('loggar statusövergångar och läcker aldrig personnummer', async () => {
    const { rows } = await db.query("SELECT event_type, metadata FROM activity_events WHERE event_type LIKE 'billing.%' AND project_id = $1", [s.p1])
    const types = new Set(rows.map((r) => r.event_type))
    for (const t of ['billing.settings_updated', 'billing.lines_updated', 'billing.plan_updated', 'billing.part_status_changed', 'billing.payment_recorded', 'billing.rot_status_changed', 'billing.ata_imported', 'billing.correction_created']) {
      expect(types).toContain(t)
    }
    expect(JSON.stringify(rows)).not.toMatch(/9876|811218|198112/)
  })
})
