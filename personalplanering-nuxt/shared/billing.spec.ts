import { describe, expect, it } from 'vitest'
import {
  computeBilling,
  displayPrice,
  installmentTargets,
  lineExOre,
  maxRot,
  normalizePersonnummer,
  parseScaled,
  partBlockingErrors,
  priceExToInc,
  priceIncToEx,
  proposeAllocation,
  summarize,
  lineItems,
  formatOre,
  type BillingInput,
  type PartInput,
  type CalcLine,
} from './billing'

const KR = (n: number) => n * 100

function part(id: number, percent: number, extra: Partial<PartInput> = {}): PartInput {
  return {
    id,
    kind: 'installment',
    name: `Del ${id}`,
    sort_order: id,
    percent_bp: percent * 100,
    status: 'planerad',
    rot_rate_bp: 3000,
    lines: [],
    rot_recipients: [
      { position: 1, name: null, has_valid_pnr: false, amount_ore: 0 },
      { position: 2, name: null, has_valid_pnr: false, amount_ore: 0 },
    ],
    locked_summary: null,
    customer_paid_ore: 0,
    rot_status: 'ej_sokt',
    rot_applied_ore: 0,
    rot_paid_ore: 0,
    ...extra,
  }
}

// Acceptanstest: grundavtal 200 000 kr inkl. 25 % moms – 100 000 kr berättigat
// arbete och 100 000 kr material (inkl. moms). 30/40/30.
function acceptance(): BillingInput {
  const work: CalcLine & { id: number } = {
    id: 1, description: 'Arbete', line_type: 'arbete', quantity: '1', unit: 'st',
    unit_price_ex_vat: priceIncToEx('100000', 2500)!, vat_rate_bp: 2500, rot_eligible: true,
  }
  const mat: CalcLine & { id: number } = {
    id: 2, description: 'Material', line_type: 'material', quantity: '1', unit: 'st',
    unit_price_ex_vat: priceIncToEx('100000', 2500)!, vat_rate_bp: 2500, rot_eligible: false,
  }
  const parts = [part(10, 30), part(11, 40), part(12, 30)]
  const allocations = proposeAllocation([work, mat], parts, [])
  return { base_total_inc_ore: KR(200000), rot_enabled: true, base_lines: [work, mat], parts, allocations }
}

describe('decimaler och moms', () => {
  it('tolkar svenska decimaltal utan flyttal', () => {
    expect(parseScaled('1 250,50', 2)).toBe(125050n)
    expect(parseScaled('0.1', 6)).toBe(100000n)
    expect(parseScaled('2.0005', 3)).toBe(2001n) // half-up
    expect(parseScaled('abc', 2)).toBeNull()
    expect(parseScaled('', 2)).toBeNull()
  })

  it('radsumma = antal × à-pris avrundat till öre', () => {
    expect(lineExOre({ quantity: '3', unit_price_ex_vat: '0.1' })).toBe(30)
    expect(lineExOre({ quantity: '2.5', unit_price_ex_vat: '650' })).toBe(162500)
    expect(lineExOre({ quantity: '0.333', unit_price_ex_vat: '10' })).toBe(333)
  })

  it('1 000 kr exkl. 25 % moms visas som 1 250 kr inkl. moms', () => {
    expect(displayPrice('1000', 2500, 'inc')).toBe('1250.00')
    expect(displayPrice('1000', 2500, 'ex')).toBe('1000.00')
    expect(priceIncToEx('1250', 2500)).toBe('1000')
  })

  it('upprepad momsväxling ändrar aldrig priset', () => {
    for (const [price, vat] of [['999.2', 2500], ['89.285714', 1200], ['1', 600], ['123.456789', 2500]] as const) {
      let stored: string = price
      for (let i = 0; i < 50; i++) {
        // Växling visar bara – det lagrade värdet rörs inte.
        displayPrice(stored, vat, 'inc')
        displayPrice(stored, vat, 'ex')
      }
      expect(stored).toBe(price)
      // Även om användaren "sparar om" det visade inkl.-värdet blir priset detsamma
      // på hela ören.
      for (let i = 0; i < 20; i++) stored = priceIncToEx(priceExToInc(stored, vat), vat)!
      expect(lineExOre({ quantity: '1', unit_price_ex_vat: stored })).toBe(lineExOre({ quantity: '1', unit_price_ex_vat: price }))
    }
  })

  it('moms beräknas per sats på summan', () => {
    const s = summarize([
      { line_type: 'arbete', ex_ore: 10001, vat_rate_bp: 2500, rot_eligible: true },
      { line_type: 'material', ex_ore: 10001, vat_rate_bp: 2500, rot_eligible: false },
      { line_type: 'ovrigt', ex_ore: 1000, vat_rate_bp: 1200, rot_eligible: false },
    ])
    expect(s.ex_ore).toBe(21002)
    expect(s.vat_ore).toBe(5001 + 120) // 20002*0.25 = 5000.5 → 5001
    expect(s.rot_basis_inc_ore).toBe(10001 + 2500)
  })
})

describe('acceptanstest 30/40/30', () => {
  it('belopp före ROT, max-ROT och 0 kr ROT tills det fylls i', () => {
    const input = acceptance()
    const r = computeBilling(input)
    expect(r.base.inc_ore).toBe(KR(200000))
    expect(r.base.diff_ore).toBe(0)
    expect(r.base_errors).toEqual([])
    const [a, b, c] = [r.parts[10]!, r.parts[11]!, r.parts[12]!]
    expect([a.amounts.inc_ore, b.amounts.inc_ore, c.amounts.inc_ore]).toEqual([KR(60000), KR(80000), KR(60000)])
    expect([a.target_inc_ore, b.target_inc_ore, c.target_inc_ore]).toEqual([KR(60000), KR(80000), KR(60000)])
    expect([a.max_rot_ore, b.max_rot_ore, c.max_rot_ore]).toEqual([KR(9000), KR(12000), KR(9000)])
    // ROT fylls aldrig i automatiskt.
    expect(input.parts.flatMap((p) => p.rot_recipients.map((x) => x.amount_ore))).toEqual([0, 0, 0, 0, 0, 0])
    expect([a.rot_total_ore, b.rot_total_ore, c.rot_total_ore]).toEqual([0, 0, 0])
    expect([a.to_pay_ore, b.to_pay_ore, c.to_pay_ore]).toEqual([KR(60000), KR(80000), KR(60000)])
    expect(a.errors).toEqual([])
  })

  it('manuellt ROT ger 51 000 / 68 000 / 51 000 och påverkar inte momsen', () => {
    const input = acceptance()
    const before = computeBilling(input)
    const rot = [9000, 12000, 9000]
    input.parts.forEach((p, i) => {
      p.rot_recipients[0] = { position: 1, name: 'Anna Andersson', has_valid_pnr: true, amount_ore: KR(rot[i]!) }
    })
    const r = computeBilling(input)
    expect(input.parts.map((p) => r.parts[p.id]!.to_pay_ore)).toEqual([KR(51000), KR(68000), KR(51000)])
    for (const p of input.parts) {
      expect(r.parts[p.id]!.amounts.vat_ore).toBe(before.parts[p.id]!.amounts.vat_ore)
      expect(r.parts[p.id]!.amounts.inc_ore).toBe(before.parts[p.id]!.amounts.inc_ore)
      expect(r.parts[p.id]!.errors).toEqual([])
    }
    expect(r.overview.total_inc_ore).toBe(KR(200000)) // försäljningen oförändrad
    expect(r.overview.customer_share_ore).toBe(KR(170000))
    expect(r.overview.rot_planned_ore).toBe(KR(30000))
  })

  it('ROT fördelat på två personer valideras mot max', () => {
    const input = acceptance()
    const p = input.parts[0]!
    p.rot_recipients = [
      { position: 1, name: 'Anna', has_valid_pnr: true, amount_ore: KR(5000) },
      { position: 2, name: 'Bo', has_valid_pnr: true, amount_ore: KR(4000) },
    ]
    expect(computeBilling(input).parts[10]!.errors).toEqual([])
    p.rot_recipients[1]!.amount_ore = KR(4001)
    expect(computeBilling(input).parts[10]!.errors.join()).toMatch(/överstiger/)
  })

  it('person med positivt ROT kräver namn och giltigt personnummer; andra personen får vara tom', () => {
    const input = acceptance()
    input.parts[0]!.rot_recipients[0] = { position: 1, name: '', has_valid_pnr: false, amount_ore: KR(100) }
    const errs = computeBilling(input).parts[10]!.errors.join('|')
    expect(errs).toMatch(/saknar namn/)
    expect(errs).toMatch(/personnummer/)
    expect(errs).not.toMatch(/Person 2/)
  })

  it('ROT avaktiverat → max 0 och belopp > 0 är fel', () => {
    const input = acceptance()
    input.rot_enabled = false
    input.parts[0]!.rot_recipients[0] = { position: 1, name: 'A', has_valid_pnr: true, amount_ore: 100 }
    const r = computeBilling(input)
    expect(r.parts[10]!.max_rot_ore).toBe(0)
    expect(r.parts[10]!.errors.join()).toMatch(/avaktiverat/)
  })
})

describe('betalningsplan och fördelning', () => {
  it('avrundning hamnar i sista öppna delen', () => {
    const t = installmentTargets(100001, [
      { id: 1, sort_order: 1, percent_bp: 3333, status: 'planerad', locked_summary: null },
      { id: 2, sort_order: 2, percent_bp: 3333, status: 'planerad', locked_summary: null },
      { id: 3, sort_order: 3, percent_bp: 3334, status: 'planerad', locked_summary: null },
    ])
    expect(t[1]).toBe(33330)
    expect(t[2]).toBe(33330)
    expect(t[3]).toBe(100001 - 66660)
  })

  it('udda belopp: varje rad fördelas exakt en gång och delarna summerar till helheten', () => {
    const lines: (CalcLine & { id: number })[] = [
      { id: 1, description: 'Grävning', line_type: 'arbete', quantity: '37.5', unit: 'tim', unit_price_ex_vat: '645.33', vat_rate_bp: 2500, rot_eligible: true },
      { id: 2, description: 'Dränrör', line_type: 'material', quantity: '42', unit: 'm', unit_price_ex_vat: '87.17', vat_rate_bp: 2500, rot_eligible: false },
      { id: 3, description: 'Container', line_type: 'ovrigt', quantity: '1', unit: 'st', unit_price_ex_vat: '3333.33', vat_rate_bp: 2500, rot_eligible: false },
    ]
    const baseInc = summarize(lineItems(lines)).inc_ore
    const parts = [part(1, 33.33), part(2, 33.33), part(3, 33.34)]
    const allocations = proposeAllocation(lines, parts, [])
    const r = computeBilling({ base_total_inc_ore: baseInc, rot_enabled: false, base_lines: lines, parts, allocations })
    expect(r.base_errors).toEqual([])
    for (const l of lines) expect(r.line_allocation[l.id]!.diff_ore).toBe(0)
    const sum = parts.reduce((s, p) => s + r.parts[p.id]!.amounts.inc_ore, 0)
    expect(sum).toBe(baseInc)
    for (const p of parts) expect(r.parts[p.id]!.errors).toEqual([])
  })

  it('upptäcker dubbel fördelning och ofullständig procent', () => {
    const input = acceptance()
    const dup = computeBilling({ ...input, allocations: [...acceptance().allocations, { part_id: 11, line_id: 2, amount_ex_ore: 500 }] })
    expect(dup.base_errors.join()).toMatch(/överfördelad/)
    const partial = acceptance()
    partial.parts[2]!.percent_bp = 2000
    const r = computeBilling(partial)
    expect(r.base_errors.join()).toMatch(/90 %, inte 100 %/)
    expect(partBlockingErrors(r, partial.parts[0]!).length).toBeGreaterThan(0)
  })

  it('differens mellan rader och grundavtal blockerar', () => {
    const input = acceptance()
    input.base_total_inc_ore = KR(200001)
    const r = computeBilling(input)
    expect(r.base.diff_ore).toBe(-100)
    expect(r.base_errors.join()).toMatch(/differens −1 kr/)
  })

  it('låsta delar ligger fast när återstående plan ändras', () => {
    const input = acceptance()
    const first = computeBilling(input).parts[10]!
    input.parts[0]!.status = 'fakturerad'
    input.parts[0]!.locked_summary = {
      amounts: first.amounts, target_inc_ore: first.target_inc_ore, max_rot_ore: first.max_rot_ore,
      rot_total_ore: 0, to_pay_ore: first.to_pay_ore,
    }
    // Ny plan för återstoden: 50/20 i stället för 40/30 och ny fördelning.
    input.parts[1]!.percent_bp = 5000
    input.parts[2]!.percent_bp = 2000
    input.allocations = proposeAllocation(input.base_lines, input.parts, input.allocations)
    const r = computeBilling(input)
    expect(r.parts[10]!.amounts.inc_ore).toBe(KR(60000))
    expect(input.allocations.filter((a) => a.part_id === 10).map((a) => a.amount_ex_ore)).toEqual([KR(24000), KR(24000)])
    expect(r.parts[11]!.amounts.inc_ore + r.parts[12]!.amounts.inc_ore).toBe(KR(140000))
    expect(r.parts[12]!.target_inc_ore).toBe(KR(200000) - KR(60000) - KR(100000))
  })
})

describe('översikt', () => {
  it('följer kundbetalningar och ROT separat', () => {
    const input = acceptance()
    const first = input.parts[0]!
    first.rot_recipients[0] = { position: 1, name: 'A', has_valid_pnr: true, amount_ore: KR(9000) }
    const pre = computeBilling(input).parts[10]!
    Object.assign(first, {
      status: 'betald',
      locked_summary: { amounts: pre.amounts, target_inc_ore: pre.target_inc_ore, max_rot_ore: pre.max_rot_ore, rot_total_ore: pre.rot_total_ore, to_pay_ore: pre.to_pay_ore },
      customer_paid_ore: KR(51000),
      rot_status: 'sokt',
      rot_applied_ore: KR(9000),
      rot_paid_ore: KR(4000),
    })
    const ov = computeBilling(input).overview
    expect(ov.invoiced_inc_ore).toBe(KR(60000))
    expect(ov.remaining_inc_ore).toBe(KR(140000))
    expect(ov.customer_paid_ore).toBe(KR(51000))
    expect(ov.customer_outstanding_ore).toBe(0)
    expect(ov.rot_applied_ore).toBe(KR(9000))
    expect(ov.rot_paid_ore).toBe(KR(4000))
    expect(ov.rot_outstanding_ore).toBe(KR(5000))
  })

  it('ÄTA-delar visas separat och kräver specifikation', () => {
    const input = acceptance()
    input.parts.push(part(20, 0, { kind: 'ata', percent_bp: null, sort_order: 100 }))
    let r = computeBilling(input)
    expect(r.parts[20]!.errors.join()).toMatch(/komplettera specifikationen/)
    input.parts[3]!.lines = [{ description: 'Extra brunn', line_type: 'material', quantity: '1', unit_price_ex_vat: '8000', vat_rate_bp: 2500, rot_eligible: false }]
    r = computeBilling(input)
    expect(r.parts[20]!.errors).toEqual([])
    expect(r.overview.ata_inc_ore).toBe(KR(10000))
    expect(r.overview.base_total_inc_ore).toBe(KR(200000))
    expect(r.overview.total_inc_ore).toBe(KR(210000))
    // ÄTA ändrar inte grundavtalets procentfördelning.
    expect(r.parts[10]!.target_inc_ore).toBe(KR(60000))
  })
})

describe('personnummer', () => {
  it('validerar Luhn och normaliserar till 12 siffror', () => {
    const today = new Date('2026-10-14')
    expect(normalizePersonnummer('811218-9876', today)).toBe('198112189876')
    expect(normalizePersonnummer('198112189876', today)).toBe('198112189876')
    expect(normalizePersonnummer('20121212-1212', today)).toBe('201212121212')
    expect(normalizePersonnummer('811218-9875', today)).toBeNull()
    expect(normalizePersonnummer('811318-9876', today)).toBeNull()
    expect(normalizePersonnummer('', today)).toBeNull()
  })
})

it('formatOre', () => {
  expect(formatOre(5100000)).toBe('51 000 kr')
  expect(formatOre(123456)).toBe('1 234,56 kr')
  expect(formatOre(-100)).toBe('−1 kr')
  expect(maxRot(KR(20000), 3000)).toBe(KR(6000))
})
