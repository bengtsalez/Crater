import type { EmployeeJob } from '../types'
import { addDays, fromISO, isoWeek, mondayOf, toISO } from './dates'

// Ren logik för personalvyn "Mina arbeten" – inga Vue/Nuxt-beroenden.

export type JobPeriod = 'upcoming' | 'this_week' | 'next_week' | 'custom'

export interface DateRange {
  from: string
  to: string
}

// Veckointervall (mån–sön) för 'this_week'/'next_week'; null för 'upcoming'.
export function periodRange(period: JobPeriod, todayISO: string, custom?: Partial<DateRange>): DateRange | null {
  if (period === 'upcoming') return null
  if (period === 'custom') {
    if (!custom?.from || !custom?.to) return null
    return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from }
  }
  const monday = addDays(mondayOf(fromISO(todayISO)), period === 'next_week' ? 7 : 0)
  return { from: toISO(monday), to: toISO(addDays(monday, 6)) }
}

export function isOngoing(job: Pick<EmployeeJob, 'start_date' | 'end_date'>, todayISO: string): boolean {
  return job.start_date <= todayISO && job.end_date >= todayISO
}

// "Idag" = bokningar som pågår idag. "Kommande" = resten, sorterade på start.
// Varje bokning är ett eget kort (flera bokningar på samma projekt → flera kort).
export function splitJobs(jobs: EmployeeJob[], todayISO: string): { today: EmployeeJob[]; upcoming: EmployeeJob[] } {
  const sorted = [...jobs].sort(
    (a, b) => a.start_date.localeCompare(b.start_date) || a.end_date.localeCompare(b.end_date) || a.assignment_id - b.assignment_id
  )
  return {
    today: sorted.filter((j) => isOngoing(j, todayISO)),
    upcoming: sorted.filter((j) => !isOngoing(j, todayISO)),
  }
}

const DAY_FMT = new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })

export function formatDay(iso: string): string {
  return DAY_FMT.format(fromISO(iso))
}

export function formatBookingPeriod(start: string, end: string): string {
  return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`
}

export function weekLabel(range: DateRange): string {
  return `v. ${isoWeek(fromISO(range.from))} (${formatDay(range.from)} – ${formatDay(range.to)})`
}

export function remainingTasksLabel(n: number): string {
  if (!n) return 'Inga uppgifter kvar'
  return `${n} uppgift${n === 1 ? '' : 'er'} kvar`
}

// ---- Adresser, karta, telefon ----

export function joinAddress(parts: (string | null | undefined)[]): string {
  return parts.map((p) => (p ?? '').trim()).filter(Boolean).join(', ')
}

export function customerAddress(c: { address: string | null; postal_code: string | null; city: string | null } | null): string {
  if (!c) return ''
  return joinAddress([c.address, joinAddress([c.postal_code, c.city]).replace(', ', ' ')])
}

function normalizeAddress(s: string): string {
  return s.toLowerCase().replace(/[\s,.]+/g, ' ').trim()
}

// Samma adress (skiftläge, komman och blanksteg ignoreras)?
export function sameAddress(a: string, b: string): boolean {
  return !!a && !!b && normalizeAddress(a) === normalizeAddress(b)
}

export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

// tel:-länk av ett fritt formaterat nummer; null om inget ringbart finns.
export function telHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/[^\d+]/g, '')
  return digits.replace(/\D/g, '').length >= 3 ? `tel:${digits}` : null
}
