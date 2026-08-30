export function toISO(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function fromISO(str: string): Date {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function addMonths(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + n, 1)
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  return addDays(d, diff)
}

// ISO-8601 veckonummer (vecka börjar måndag, vecka 1 innehåller första torsdagen).
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3)
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000))
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function isWeekend(date: Date): boolean {
  const d = date.getDay()
  return d === 0 || d === 6
}

// Anonymous Gregorian algorithm.
export function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

export function midsummerDay(year: number): Date {
  for (let d = 20; d <= 26; d++) {
    const date = new Date(year, 5, d)
    if (date.getDay() === 6) return date
  }
  return new Date(year, 5, 20)
}

export function allSaintsDay(year: number): Date {
  for (let d = 31; d <= 37; d++) {
    const date = new Date(year, 9, d)
    if (date.getDay() === 6) return date
  }
  return new Date(year, 9, 31)
}

const holidayCache = new Map<number, Map<string, string>>()

export function swedishHolidaysForYear(year: number): Map<string, string> {
  const cached = holidayCache.get(year)
  if (cached) return cached
  const easter = easterSunday(year)
  const entries: [Date, string][] = [
    [new Date(year, 0, 1), 'Nyårsdagen'],
    [new Date(year, 0, 6), 'Trettondedag jul'],
    [addDays(easter, -2), 'Långfredagen'],
    [easter, 'Påskdagen'],
    [addDays(easter, 1), 'Annandag påsk'],
    [new Date(year, 4, 1), 'Första maj'],
    [addDays(easter, 39), 'Kristi himmelsfärdsdag'],
    [addDays(easter, 49), 'Pingstdagen'],
    [new Date(year, 5, 6), 'Sveriges nationaldag'],
    [midsummerDay(year), 'Midsommardagen'],
    [allSaintsDay(year), 'Alla helgons dag'],
    [new Date(year, 11, 25), 'Juldagen'],
    [new Date(year, 11, 26), 'Annandag jul'],
  ]
  const map = new Map(entries.map(([d, name]) => [toISO(d), name]))
  holidayCache.set(year, map)
  return map
}

export function isHoliday(date: Date): boolean {
  return swedishHolidaysForYear(date.getFullYear()).has(toISO(date))
}

export function holidayName(date: Date): string {
  return swedishHolidaysForYear(date.getFullYear()).get(toISO(date)) || ''
}
