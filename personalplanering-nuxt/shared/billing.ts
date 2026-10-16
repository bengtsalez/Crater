// Ren beräkningslogik för Fakturering – delas av klient (app/) och server
// (server/utils/billing.ts). Inga Vue-/Nitro-beroenden, inga flyttal i belopp:
//
//  - Belopp: heltal i öre (number; säkert långt över alla rimliga projekt).
//  - Antal: decimalsträng, 3 decimaler (NUMERIC(14,3)).
//  - À-pris: decimalsträng exkl. moms, 6 decimaler (NUMERIC(20,6)). Det lagrade
//    priset är ALLTID exkl. moms; växeln "Inkl. moms" är bara visning. Ett pris
//    som matas in inkl. moms räknas om till exkl. moms en gång, så upprepad
//    växling ändrar aldrig beloppet.
//  - Momssats och ROT-procent: baspunkter (2500 = 25 %).
//  - Avrundning: half-up (bort från noll) till hela öre.
//
// ROT minskar bara kundens betalning ("Att betala") – aldrig försäljning eller
// momsunderlag. ROT-belopp fylls ALDRIG i automatiskt: maxRot() är ett
// beräkningsstöd, mottagarnas belopp anges manuellt.

export const QTY_SCALE = 3
export const PRICE_SCALE = 6
export const DEFAULT_VAT_BP = 2500
export const DEFAULT_ROT_BP = 3000
/** Tillåten avrundningsdifferens mellan en delbetalnings belopp och dess mål. */
export const PART_TOLERANCE_ORE = 100

export type LineType = 'arbete' | 'material' | 'ovrigt'
export const LINE_TYPES: LineType[] = ['arbete', 'material', 'ovrigt']
export const LINE_TYPE_LABELS: Record<LineType, string> = { arbete: 'Arbete', material: 'Material', ovrigt: 'Övrigt' }
export const UNITS = ['tim', 'st', 'm', 'm²', 'm³', 'kg', 'ton', 'lpm', 'dag']

export type PartKind = 'installment' | 'ata' | 'correction'
export type PartStatus = 'planerad' | 'klar' | 'fakturerad' | 'betald'
export type RotStatus = 'ej_sokt' | 'sokt' | 'utbetalt' | 'avslag'
export type AtaStatus = 'utkast' | 'skickad' | 'godkand' | 'avbojd'

export const PART_STATUS_LABELS: Record<PartStatus, string> = {
  planerad: 'Planerad',
  klar: 'Klar för fakturering',
  fakturerad: 'Fakturerad',
  betald: 'Betald',
}
export const ROT_STATUS_LABELS: Record<RotStatus, string> = {
  ej_sokt: 'Ej sökt',
  sokt: 'Sökt',
  utbetalt: 'Utbetalt',
  avslag: 'Avslag',
}
export const ATA_STATUS_LABELS: Record<AtaStatus, string> = {
  utkast: 'Utkast',
  skickad: 'Skickad',
  godkand: 'Godkänd',
  avbojd: 'Avböjd',
}
export const PART_KIND_LABELS: Record<PartKind, string> = {
  installment: 'Delbetalning',
  ata: 'ÄTA',
  correction: 'Korrigering',
}

export function isLockedStatus(s: PartStatus): boolean {
  return s === 'fakturerad' || s === 'betald'
}

// ---------------------------------------------------------------------------
// Decimalaritmetik (BigInt, fast skala)
// ---------------------------------------------------------------------------

const TEN = 10n
function pow10(n: number): bigint {
  return TEN ** BigInt(n)
}

/** Heltalsdivision med half-up-avrundning (bort från noll). */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error('division med noll')
  const neg = n < 0n !== d < 0n
  const an = n < 0n ? -n : n
  const ad = d < 0n ? -d : d
  const q = (an * 2n + ad) / (ad * 2n)
  return neg ? -q : q
}

/**
 * Tolkar en decimalsträng ("1 250,50", "-3.5", 12) till ett heltal i given
 * skala. Fler decimaler än skalan avrundas half-up. Ogiltig indata → null.
 */
export function parseScaled(input: string | number | null | undefined, scale: number): bigint | null {
  if (input === null || input === undefined) return null
  let s = typeof input === 'number' ? (Number.isFinite(input) ? String(input) : '') : String(input)
  s = s.replace(/[\s  ]/g, '').replace(',', '.')
  if (!s) return null
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s)
  if (!m || (!m[2] && !m[3])) return null
  const neg = m[1] === '-'
  const intPart = m[2] || '0'
  const frac = m[3] || ''
  let v: bigint
  if (frac.length <= scale) {
    v = BigInt(intPart + frac.padEnd(scale, '0'))
  } else {
    const all = BigInt(intPart + frac)
    v = divRound(all, pow10(frac.length - scale))
  }
  return neg ? -v : v
}

/** Formaterar ett skalat heltal som decimalsträng med punkt, utan tusentalsavgränsare. */
export function formatScaled(v: bigint, scale: number, minDecimals = 0): string {
  const neg = v < 0n
  const a = neg ? -v : v
  const p = pow10(scale)
  const int = (a / p).toString()
  let frac = scale > 0 ? (a % p).toString().padStart(scale, '0') : ''
  while (frac.length > minDecimals && frac.endsWith('0')) frac = frac.slice(0, -1)
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '')
}

/** Normaliserar en antal-/prissträng till kanonisk form (eller null om ogiltig). */
export function normalizeDecimal(input: string | number | null | undefined, scale: number): string | null {
  const v = parseScaled(input, scale)
  return v === null ? null : formatScaled(v, scale)
}

/** Kronor (sträng/nummer, max 2 decimaler efter avrundning) → öre. */
export function kronorToOre(input: string | number | null | undefined): number | null {
  const v = parseScaled(input, 2)
  return v === null ? null : Number(v)
}

export function oreToKronorString(ore: number): string {
  return formatScaled(BigInt(ore), 2)
}

// ---------------------------------------------------------------------------
// Moms och rader
// ---------------------------------------------------------------------------

/** À-pris exkl. moms → inkl. moms (för visning). */
export function priceExToInc(priceEx: string, vatBp: number): string {
  const p = parseScaled(priceEx, PRICE_SCALE)
  if (p === null) return ''
  return formatScaled(divRound(p * BigInt(10000 + vatBp), 10000n), PRICE_SCALE)
}

/** À-pris inkl. moms (inmatat) → exkl. moms (lagras). */
export function priceIncToEx(priceInc: string | number, vatBp: number): string | null {
  const p = parseScaled(priceInc, PRICE_SCALE)
  if (p === null) return null
  return formatScaled(divRound(p * 10000n, BigInt(10000 + vatBp)), PRICE_SCALE)
}

/** Visningsvärde för à-pris i valt läge, avrundat till 2 decimaler. */
export function displayPrice(priceEx: string, vatBp: number, mode: 'ex' | 'inc'): string {
  const v = mode === 'inc' ? priceExToInc(priceEx, vatBp) : priceEx
  const s = parseScaled(v, 2)
  return s === null ? '' : formatScaled(s, 2, 2)
}

export function vatOf(exOre: number, vatBp: number): number {
  return Number(divRound(BigInt(exOre) * BigInt(vatBp), 10000n))
}

export interface CalcLine {
  id?: number
  description?: string
  line_type: LineType
  quantity: string
  unit?: string | null
  unit_price_ex_vat: string
  vat_rate_bp: number
  rot_eligible: boolean
}

/** Radsumma exkl. moms i öre (antal × à-pris, half-up). null vid ogiltig indata. */
export function lineExOre(line: Pick<CalcLine, 'quantity' | 'unit_price_ex_vat'>): number | null {
  const q = parseScaled(line.quantity, QTY_SCALE)
  const p = parseScaled(line.unit_price_ex_vat, PRICE_SCALE)
  if (q === null || p === null) return null
  // skala 3 + 6 = 9 → öre (skala 2)
  return Number(divRound(q * p, pow10(QTY_SCALE + PRICE_SCALE - 2)))
}

/** Ett belopp som ingår i en del (en fakturarad eller en fördelad andel av en). */
export interface AmountItem {
  line_type: LineType
  ex_ore: number
  vat_rate_bp: number
  rot_eligible: boolean
}

export interface Amounts {
  ex_ore: number
  vat_ore: number
  inc_ore: number
  work_ex_ore: number
  material_ex_ore: number
  other_ex_ore: number
  /** ROT-berättigad arbetskostnad inkl. moms. */
  rot_basis_inc_ore: number
  /** Momsunderlag per sats: { "2500": exOre } */
  vat_by_rate: Record<string, { ex_ore: number; vat_ore: number }>
}

/**
 * Summerar belopp. Momsen beräknas per momssats på summan (inte per rad).
 * `vatOverride` används för den sista öppna delbetalningen, som tar upp
 * avrundningsdifferensen så att delarna tillsammans exakt motsvarar helheten.
 */
export function summarize(items: AmountItem[], vatOverride?: Record<string, number>): Amounts {
  const byRate: Record<string, { ex_ore: number; vat_ore: number }> = {}
  const rotByRate: Record<string, number> = {}
  let work = 0
  let material = 0
  let other = 0
  for (const it of items) {
    const k = String(it.vat_rate_bp)
    byRate[k] ??= { ex_ore: 0, vat_ore: 0 }
    byRate[k].ex_ore += it.ex_ore
    if (it.line_type === 'arbete') work += it.ex_ore
    else if (it.line_type === 'material') material += it.ex_ore
    else other += it.ex_ore
    if (it.rot_eligible && it.line_type === 'arbete') rotByRate[k] = (rotByRate[k] ?? 0) + it.ex_ore
  }
  let ex = 0
  let vat = 0
  for (const [k, g] of Object.entries(byRate)) {
    g.vat_ore = vatOverride && k in vatOverride ? vatOverride[k]! : vatOf(g.ex_ore, Number(k))
    ex += g.ex_ore
    vat += g.vat_ore
  }
  let rotBasis = 0
  for (const [k, e] of Object.entries(rotByRate)) rotBasis += e + vatOf(e, Number(k))
  return {
    ex_ore: ex,
    vat_ore: vat,
    inc_ore: ex + vat,
    work_ex_ore: work,
    material_ex_ore: material,
    other_ex_ore: other,
    rot_basis_inc_ore: rotBasis,
    vat_by_rate: byRate,
  }
}

export function lineItems(lines: CalcLine[]): AmountItem[] {
  return lines.map((l) => ({
    line_type: l.line_type,
    ex_ore: lineExOre(l) ?? 0,
    vat_rate_bp: l.vat_rate_bp,
    rot_eligible: l.rot_eligible && l.line_type === 'arbete',
  }))
}

/** Beräknat maximalt ROT (beräkningsstöd): ROT-berättigat arbete inkl. moms × procentsats. */
export function maxRot(rotBasisIncOre: number, rotRateBp: number): number {
  return Number(divRound(BigInt(rotBasisIncOre) * BigInt(rotRateBp), 10000n))
}

/** Antal motsvarande en fördelad andel av en rad (för visning), 3 decimaler. */
export function allocatedQuantity(line: CalcLine, allocExOre: number): string {
  const total = lineExOre(line)
  const q = parseScaled(line.quantity, QTY_SCALE)
  if (!total || q === null) return '0'
  return formatScaled(divRound(q * BigInt(allocExOre), BigInt(total)), QTY_SCALE)
}

// ---------------------------------------------------------------------------
// Personnummer
// ---------------------------------------------------------------------------

/**
 * Validerar och normaliserar ett svenskt personnummer/samordningsnummer till
 * 12 siffror (ÅÅÅÅMMDDNNNN). Accepterar 10 eller 12 siffror, med eller utan
 * '-'/'+'. Kontrollsiffra enligt Luhn. Ogiltigt → null.
 */
export function normalizePersonnummer(input: string | null | undefined, today: Date = new Date()): string | null {
  if (!input) return null
  const s = String(input).replace(/\s/g, '')
  const m = /^(\d{2})?(\d{2})(\d{2})(\d{2})([-+]?)(\d{4})$/.exec(s)
  if (!m) return null
  const [, cent, yy, mm, dd, sep, last4] = m as unknown as string[]
  const month = Number(mm)
  let day = Number(dd)
  if (day > 60) day -= 60 // samordningsnummer
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const ten = `${yy}${mm}${dd}${last4}`
  let sum = 0
  for (let i = 0; i < 9; i++) {
    let d = Number(ten[i]) * (i % 2 === 0 ? 2 : 1)
    if (d > 9) d -= 9
    sum += d
  }
  if ((10 - (sum % 10)) % 10 !== Number(ten[9])) return null
  let century = cent
  if (!century) {
    const curYear = today.getFullYear()
    let year = Math.floor(curYear / 100) * 100 + Number(yy)
    if (year > curYear) year -= 100
    if (sep === '+') year -= 100
    century = String(Math.floor(year / 100))
  }
  return `${century}${yy}${mm}${dd}${last4}`
}

/** "ÅÅÅÅMMDD-NNNN" */
export function formatPersonnummer(pnr12: string): string {
  return pnr12.length === 12 ? `${pnr12.slice(0, 8)}-${pnr12.slice(8)}` : pnr12
}

export function maskPersonnummer(last4: string | null | undefined, pnr12?: string | null): string {
  if (pnr12 && pnr12.length === 12) return `${pnr12.slice(0, 8)}-****`
  return last4 ? `********-${last4}` : ''
}

// ---------------------------------------------------------------------------
// Projektberäkning: grundavtal, betalningsplan, delar, översikt
// ---------------------------------------------------------------------------

export interface RotRecipientInput {
  position: number
  name: string | null
  /** true om ett giltigt personnummer finns lagrat/angivet. */
  has_valid_pnr: boolean
  amount_ore: number
}

export interface LockedSummary {
  amounts: Amounts
  target_inc_ore: number | null
  max_rot_ore: number
  rot_total_ore: number
  to_pay_ore: number
}

export interface PartInput {
  id: number
  kind: PartKind
  name: string
  sort_order: number
  percent_bp: number | null
  status: PartStatus
  rot_rate_bp: number
  /** Egna rader (ÄTA/korrigering). Ignoreras för delbetalningar. */
  lines: CalcLine[]
  rot_recipients: RotRecipientInput[]
  locked_summary: LockedSummary | null
  customer_paid_ore: number
  rot_status: RotStatus
  rot_applied_ore: number
  rot_paid_ore: number
  /** ÄTA: källposten har ändrats sedan hämtning och avvikelsen är inte bekräftad. */
  ata_deviation?: boolean
}

export interface AllocationInput {
  part_id: number
  line_id: number
  amount_ex_ore: number
}

export interface BillingInput {
  base_total_inc_ore: number | null
  rot_enabled: boolean
  base_lines: (CalcLine & { id: number })[]
  parts: PartInput[]
  allocations: AllocationInput[]
}

export interface PartResult {
  id: number
  amounts: Amounts
  target_inc_ore: number | null
  diff_ore: number | null
  max_rot_ore: number
  rot_total_ore: number
  to_pay_ore: number
  errors: string[]
  warnings: string[]
}

export interface Overview {
  base_total_inc_ore: number
  ata_inc_ore: number
  correction_inc_ore: number
  total_inc_ore: number
  invoiced_inc_ore: number
  remaining_inc_ore: number
  customer_share_ore: number
  customer_paid_ore: number
  customer_outstanding_ore: number
  rot_planned_ore: number
  rot_applied_ore: number
  rot_paid_ore: number
  rot_rejected_ore: number
  rot_outstanding_ore: number
}

export interface BillingResult {
  base: Amounts & { diff_ore: number | null }
  percent_sum_bp: number
  /** Per grundrad: fördelat belopp och differens mot radsumman. */
  line_allocation: Record<number, { total_ex_ore: number; allocated_ex_ore: number; diff_ore: number }>
  base_errors: string[]
  parts: Record<number, PartResult>
  overview: Overview
}

function byOrder<T extends { sort_order: number; id: number }>(a: T, b: T) {
  return a.sort_order - b.sort_order || a.id - b.id
}

export function formatPercentBp(bp: number): string {
  return formatScaled(BigInt(bp), 2).replace('.', ',') + ' %'
}

function kr(ore: number): string {
  const s = formatScaled(BigInt(Math.abs(ore)), 2, 0)
  const [i, f] = s.split('.')
  const int = i!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (ore < 0 ? '−' : '') + int + (f ? ',' + f.padEnd(2, '0') : '') + ' kr'
}

/** Svenskt belopp, "12 345,50 kr", ur öre. */
export const formatOre = kr

/**
 * Målbelopp (inkl. moms före ROT) per delbetalning. Låsta delar behåller sitt
 * fakturerade belopp; de öppna delarna får total × procent, och den SISTA
 * öppna delen tar upp avrundningen så att planen exakt motsvarar avtalet.
 */
export function installmentTargets(
  baseTotalIncOre: number,
  installments: Pick<PartInput, 'id' | 'sort_order' | 'percent_bp' | 'status' | 'locked_summary'>[]
): Record<number, number> {
  const out: Record<number, number> = {}
  const sorted = [...installments].sort(byOrder)
  const open = sorted.filter((p) => !isLockedStatus(p.status))
  let lockedSum = 0
  for (const p of sorted) {
    if (isLockedStatus(p.status)) {
      const v = p.locked_summary?.amounts.inc_ore ?? 0
      out[p.id] = v
      lockedSum += v
    }
  }
  let openSum = 0
  open.forEach((p, i) => {
    if (i === open.length - 1) {
      out[p.id] = baseTotalIncOre - lockedSum - openSum
    } else {
      const v = Number(divRound(BigInt(baseTotalIncOre) * BigInt(p.percent_bp ?? 0), 10000n))
      out[p.id] = v
      openSum += v
    }
  })
  return out
}

/**
 * Föreslår en proportionell fördelning av grundraderna på de ÖPPNA
 * delbetalningarna, efter deras procentandel. Låsta delars fördelning ligger
 * fast; det som återstår av varje rad fördelas, och den sista öppna delen får
 * radens rest så att varje rad fördelas exakt en gång – aldrig dubbelt.
 */
export function proposeAllocation(
  baseLines: (CalcLine & { id: number })[],
  installments: Pick<PartInput, 'id' | 'sort_order' | 'percent_bp' | 'status'>[],
  existing: AllocationInput[]
): AllocationInput[] {
  const sorted = [...installments].sort(byOrder)
  const lockedIds = new Set(sorted.filter((p) => isLockedStatus(p.status)).map((p) => p.id))
  const open = sorted.filter((p) => !lockedIds.has(p.id))
  const kept = existing.filter((a) => lockedIds.has(a.part_id))
  if (!open.length) return kept
  const weightSum = open.reduce((s, p) => s + (p.percent_bp ?? 0), 0)
  const out: AllocationInput[] = [...kept]
  for (const line of baseLines) {
    const total = lineExOre(line) ?? 0
    const lockedAlloc = kept.filter((a) => a.line_id === line.id).reduce((s, a) => s + a.amount_ex_ore, 0)
    const remaining = total - lockedAlloc
    let given = 0
    open.forEach((p, i) => {
      let v: number
      if (i === open.length - 1) v = remaining - given
      else if (weightSum === 0) v = 0
      else v = Number(divRound(BigInt(remaining) * BigInt(p.percent_bp ?? 0), BigInt(weightSum)))
      given += v
      out.push({ part_id: p.id, line_id: line.id, amount_ex_ore: v })
    })
  }
  return out
}

function rotChecks(part: PartInput, rotEnabled: boolean, max: number, errors: string[]): number {
  const total = part.rot_recipients.reduce((s, r) => s + (r.amount_ore || 0), 0)
  if (part.kind === 'correction') {
    if (total) errors.push('Korrigeringar kan inte ha ROT-belopp.')
    return 0
  }
  for (const r of part.rot_recipients) {
    if (r.amount_ore < 0) errors.push(`ROT-belopp för person ${r.position} får inte vara negativt.`)
    if (r.amount_ore > 0) {
      if (!r.name?.trim()) errors.push(`Person ${r.position} med ROT-belopp saknar namn.`)
      if (!r.has_valid_pnr) errors.push(`Person ${r.position} med ROT-belopp saknar giltigt personnummer.`)
    }
  }
  if (!rotEnabled && total > 0) errors.push('ROT är avaktiverat för projektet men delen har ROT-belopp.')
  if (total > max) errors.push(`ROT-beloppen (${kr(total)}) överstiger beräknat maximalt ROT (${kr(max)}).`)
  return rotEnabled ? total : 0
}

/** Hela projektets beräkning: grundunderlag, plan, varje del och översikten. */
export function computeBilling(input: BillingInput): BillingResult {
  const baseAmounts = summarize(lineItems(input.base_lines))
  const baseDiff = input.base_total_inc_ore === null ? null : baseAmounts.inc_ore - input.base_total_inc_ore
  const baseErrors: string[] = []
  for (const l of input.base_lines) {
    if (lineExOre(l) === null) baseErrors.push(`Raden "${l.description || '–'}" har ogiltigt antal eller pris.`)
    if (l.rot_eligible && l.line_type !== 'arbete') baseErrors.push(`Raden "${l.description || '–'}": bara arbete kan vara ROT-berättigat.`)
  }
  if (input.base_total_inc_ore === null) baseErrors.push('Grundavtalets totalsumma saknas.')
  else if (baseDiff !== 0) baseErrors.push(`Fakturaraderna motsvarar inte grundavtalet (differens ${kr(baseDiff!)}).`)

  const installments = input.parts.filter((p) => p.kind === 'installment').sort(byOrder)
  const percentSum = installments.reduce((s, p) => s + (p.percent_bp ?? 0), 0)
  if (installments.length && percentSum !== 10000) {
    baseErrors.push(`Delbetalningarna summerar till ${formatPercentBp(percentSum)}, inte 100 %.`)
  }

  // Fördelningskontroll per rad.
  const lineAlloc: BillingResult['line_allocation'] = {}
  const instIds = new Set(installments.map((p) => p.id))
  for (const l of input.base_lines) {
    const total = lineExOre(l) ?? 0
    const allocated = input.allocations
      .filter((a) => a.line_id === l.id && instIds.has(a.part_id))
      .reduce((s, a) => s + a.amount_ex_ore, 0)
    lineAlloc[l.id] = { total_ex_ore: total, allocated_ex_ore: allocated, diff_ore: allocated - total }
    if (installments.length && allocated !== total) {
      baseErrors.push(
        `Raden "${l.description || '–'}" är ${allocated > total ? 'överfördelad' : 'inte helt fördelad'} (${kr(allocated - total)}).`
      )
    }
  }

  // Delbetalningar: belopp ur fördelningen. Den sista öppna delen tar upp
  // momsavrundningen så att summan av delarna är exakt grundunderlagets.
  const targets = input.base_total_inc_ore === null ? {} : installmentTargets(input.base_total_inc_ore, installments)
  const lineById = new Map(input.base_lines.map((l) => [l.id, l]))
  const instItems = (partId: number): AmountItem[] =>
    input.allocations
      .filter((a) => a.part_id === partId)
      .map((a) => {
        const l = lineById.get(a.line_id)
        return {
          line_type: l?.line_type ?? 'ovrigt',
          ex_ore: a.amount_ex_ore,
          vat_rate_bp: l?.vat_rate_bp ?? DEFAULT_VAT_BP,
          rot_eligible: !!l?.rot_eligible && l.line_type === 'arbete',
        }
      })
  const openInst = installments.filter((p) => !isLockedStatus(p.status))
  const lastOpen = openInst[openInst.length - 1]
  const instAmounts: Record<number, Amounts> = {}
  for (const p of installments) {
    if (isLockedStatus(p.status) && p.locked_summary) instAmounts[p.id] = p.locked_summary.amounts
    else if (p !== lastOpen) instAmounts[p.id] = summarize(instItems(p.id))
  }
  if (lastOpen) {
    const items = instItems(lastOpen.id)
    const prelim = summarize(items)
    const override: Record<string, number> = {}
    for (const k of Object.keys(prelim.vat_by_rate)) {
      const others = installments
        .filter((p) => p !== lastOpen)
        .reduce((s, p) => s + (instAmounts[p.id]?.vat_by_rate[k]?.vat_ore ?? 0), 0)
      const baseVat = baseAmounts.vat_by_rate[k]?.vat_ore
      // Bara när fördelningen är komplett – annars vore "resten" meningslös.
      const allocComplete = Object.values(lineAlloc).every((x) => x.diff_ore === 0)
      if (baseVat !== undefined && allocComplete) {
        const candidate = baseVat - others
        // Rimlighetsspärr: avrundningsjustering, inte en omfördelning.
        if (Math.abs(candidate - prelim.vat_by_rate[k]!.vat_ore) <= installments.length) override[k] = candidate
      }
    }
    instAmounts[lastOpen.id] = summarize(items, override)
  }

  const parts: Record<number, PartResult> = {}
  for (const p of [...input.parts].sort(byOrder)) {
    const errors: string[] = []
    const warnings: string[] = []
    const locked = isLockedStatus(p.status) && p.locked_summary
    if (locked) {
      const ls = p.locked_summary!
      parts[p.id] = {
        id: p.id,
        amounts: ls.amounts,
        target_inc_ore: ls.target_inc_ore,
        diff_ore: ls.target_inc_ore === null ? null : ls.amounts.inc_ore - ls.target_inc_ore,
        max_rot_ore: ls.max_rot_ore,
        rot_total_ore: ls.rot_total_ore,
        to_pay_ore: ls.to_pay_ore,
        errors,
        warnings,
      }
      continue
    }
    let amounts: Amounts
    let target: number | null = null
    if (p.kind === 'installment') {
      amounts = instAmounts[p.id] ?? summarize([])
      target = targets[p.id] ?? null
      if (target !== null && Math.abs(amounts.inc_ore - target) > PART_TOLERANCE_ORE) {
        errors.push(`Delens belopp (${kr(amounts.inc_ore)}) motsvarar inte planerat belopp (${kr(target)}).`)
      } else if (target !== null && amounts.inc_ore !== target) {
        warnings.push(`Avrundningsdifferens mot planerat belopp: ${kr(amounts.inc_ore - target)}.`)
      }
    } else {
      for (const l of p.lines) {
        if (lineExOre(l) === null) errors.push(`Raden "${l.description || '–'}" har ogiltigt antal eller pris.`)
        if (!l.description?.trim()) errors.push('En fakturarad saknar beskrivning.')
      }
      amounts = summarize(lineItems(p.lines))
      if (p.kind === 'ata' && !p.lines.length) {
        errors.push('ÄTA:n har bara ett totalbelopp – komplettera specifikationen med fakturarader.')
      }
      if (p.ata_deviation) errors.push('Ursprunglig ÄTA har ändrats efter hämtningen – granska och bekräfta avvikelsen.')
    }
    const max = input.rot_enabled && p.kind !== 'correction' ? maxRot(amounts.rot_basis_inc_ore, p.rot_rate_bp) : 0
    const rotTotal = rotChecks(p, input.rot_enabled, max, errors)
    parts[p.id] = {
      id: p.id,
      amounts,
      target_inc_ore: target,
      diff_ore: target === null ? null : amounts.inc_ore - target,
      max_rot_ore: max,
      rot_total_ore: rotTotal,
      to_pay_ore: amounts.inc_ore - rotTotal,
      errors,
      warnings,
    }
  }

  // Översikt.
  const ov: Overview = {
    base_total_inc_ore: input.base_total_inc_ore ?? 0,
    ata_inc_ore: 0,
    correction_inc_ore: 0,
    total_inc_ore: 0,
    invoiced_inc_ore: 0,
    remaining_inc_ore: 0,
    customer_share_ore: 0,
    customer_paid_ore: 0,
    customer_outstanding_ore: 0,
    rot_planned_ore: 0,
    rot_applied_ore: 0,
    rot_paid_ore: 0,
    rot_rejected_ore: 0,
    rot_outstanding_ore: 0,
  }
  for (const p of input.parts) {
    const r = parts[p.id]!
    if (p.kind === 'ata') ov.ata_inc_ore += r.amounts.inc_ore
    if (p.kind === 'correction') ov.correction_inc_ore += r.amounts.inc_ore
    ov.customer_share_ore += r.to_pay_ore
    ov.customer_paid_ore += p.customer_paid_ore
    ov.rot_planned_ore += r.rot_total_ore
    ov.rot_applied_ore += p.rot_applied_ore
    ov.rot_paid_ore += p.rot_paid_ore
    if (isLockedStatus(p.status)) {
      ov.invoiced_inc_ore += r.amounts.inc_ore
      ov.customer_outstanding_ore += Math.max(0, r.to_pay_ore - p.customer_paid_ore)
      if (p.rot_status === 'avslag') ov.rot_rejected_ore += Math.max(0, r.rot_total_ore - p.rot_paid_ore)
      else ov.rot_outstanding_ore += Math.max(0, r.rot_total_ore - p.rot_paid_ore)
    }
  }
  ov.total_inc_ore = ov.base_total_inc_ore + ov.ata_inc_ore + ov.correction_inc_ore
  ov.remaining_inc_ore = ov.total_inc_ore - ov.invoiced_inc_ore

  return {
    base: { ...baseAmounts, diff_ore: baseDiff },
    percent_sum_bp: percentSum,
    line_allocation: lineAlloc,
    base_errors: baseErrors,
    parts,
    overview: ov,
  }
}

/** Fel som blockerar att delen markeras "Klar för fakturering"/"Fakturerad". */
export function partBlockingErrors(result: BillingResult, part: Pick<PartInput, 'id' | 'kind'>): string[] {
  const own = result.parts[part.id]?.errors ?? []
  return part.kind === 'installment' ? [...result.base_errors, ...own] : own
}
