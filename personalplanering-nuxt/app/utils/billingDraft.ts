// Redigerbara fakturarader i klienten. Priset lagras alltid exkl. moms
// (`unit_price_ex_vat`); `price_text` är bara vad användaren ser/skriver i valt
// prisläge. Växling av prisläge skriver om texten från det lagrade priset och
// ändrar aldrig själva priset.
import {
  DEFAULT_VAT_BP,
  displayPrice,
  lineExOre,
  normalizeDecimal,
  priceIncToEx,
  PRICE_SCALE,
  vatOf,
  type CalcLine,
  type LineType,
} from '../../shared/billing'

export type PriceMode = 'ex' | 'inc'

export interface DraftLine {
  key: string
  id: number | null
  description: string
  line_type: LineType
  quantity: string
  unit: string
  unit_price_ex_vat: string
  vat_rate_bp: number
  rot_eligible: boolean
  price_text: string
  /** Raden ingår i en fakturerad del – ekonomiska fält är låsta. */
  locked?: boolean
}

let seq = 0
const nextKey = () => `l${++seq}`

export function toDraft(l: CalcLine & { id?: number | null; unit?: string | null }, mode: PriceMode, locked = false): DraftLine {
  return {
    key: nextKey(),
    id: l.id ?? null,
    description: l.description ?? '',
    line_type: l.line_type,
    quantity: (l.quantity ?? '').replace('.', ','),
    unit: l.unit ?? '',
    unit_price_ex_vat: l.unit_price_ex_vat,
    vat_rate_bp: l.vat_rate_bp,
    rot_eligible: l.rot_eligible,
    price_text: displayPrice(l.unit_price_ex_vat, l.vat_rate_bp, mode).replace('.', ','),
    locked,
  }
}

export function newDraft(mode: PriceMode, lineType: LineType = 'arbete'): DraftLine {
  return toDraft(
    { description: '', line_type: lineType, quantity: '1', unit: lineType === 'arbete' ? 'tim' : 'st', unit_price_ex_vat: '0', vat_rate_bp: DEFAULT_VAT_BP, rot_eligible: false },
    mode
  )
}

/** Användaren skriver ett pris i aktuellt läge → lagrat pris exkl. moms. */
export function setPriceText(d: DraftLine, text: string, mode: PriceMode) {
  d.price_text = text
  const ex = mode === 'inc' ? priceIncToEx(text, d.vat_rate_bp) : normalizeDecimal(text, PRICE_SCALE)
  d.unit_price_ex_vat = ex ?? ''
}

/** Prisläget växlas (eller momssatsen ändras): bara texten skrivs om. */
export function refreshPriceText(d: DraftLine, mode: PriceMode) {
  if (d.unit_price_ex_vat === '') return
  d.price_text = displayPrice(d.unit_price_ex_vat, d.vat_rate_bp, mode).replace('.', ',')
}

export function draftExOre(d: DraftLine): number | null {
  return lineExOre({ quantity: d.quantity, unit_price_ex_vat: d.unit_price_ex_vat })
}

export function draftSumOre(d: DraftLine, mode: PriceMode): number | null {
  const ex = draftExOre(d)
  if (ex === null) return null
  return mode === 'inc' ? ex + vatOf(ex, d.vat_rate_bp) : ex
}

export function draftToCalc(d: DraftLine): CalcLine & { id: number } {
  return {
    id: d.id ?? 0,
    description: d.description,
    line_type: d.line_type,
    quantity: normalizeDecimal(d.quantity, 3) ?? '',
    unit: d.unit,
    unit_price_ex_vat: d.unit_price_ex_vat,
    vat_rate_bp: d.vat_rate_bp,
    rot_eligible: d.rot_eligible && d.line_type === 'arbete',
  }
}

/** Payload till servern. */
export function draftPayload(d: DraftLine) {
  return {
    id: d.id,
    description: d.description.trim(),
    line_type: d.line_type,
    quantity: d.quantity,
    unit: d.unit.trim(),
    unit_price_ex_vat: d.unit_price_ex_vat,
    vat_rate_bp: d.vat_rate_bp,
    rot_eligible: d.rot_eligible && d.line_type === 'arbete',
  }
}

/** Belopp i kronor (text) för inmatning, ur öre. */
export function oreToInput(ore: number | null | undefined): string {
  if (ore === null || ore === undefined) return ''
  const neg = ore < 0
  const a = Math.abs(ore)
  const kr = Math.floor(a / 100)
  const o = a % 100
  return (neg ? '-' : '') + String(kr) + (o ? ',' + String(o).padStart(2, '0') : '')
}

export function percentInput(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return ''
  return (bp / 100).toString().replace('.', ',')
}
