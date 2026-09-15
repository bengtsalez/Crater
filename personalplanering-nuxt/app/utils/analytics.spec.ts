import { describe, it, expect } from 'vitest'
import { toISO, addDays } from './dates'
import {
  filterProjectsByDepartment,
  projectHasCurrentOrFutureAssignment,
  getUpcomingScheduledProjects,
  getUpcomingScheduledValue,
  getFutureSignedProjects,
  getDelayedStartProjects,
  getActiveTodayProjects,
  getActiveProjectsToday,
  getUnstaffedUpcomingProjects,
  compareProjects,
} from './analytics'
import type { Project, Assignment } from '../types'

const TODAY = new Date(2026, 8, 3) // 2026-09-03, lokal tid
const at = (offsetDays: number) => toISO(addDays(TODAY, offsetDays))

let seq = 1
function mkProject(p: Partial<Project> = {}): Project {
  const id = seq++
  return {
    id,
    project_number: `26-${id}`,
    name: `Projekt ${id}`,
    client: null,
    customer_id: null,
    customer_name: null,
    project_manager_user_id: null,
    project_manager_username: null,
    sum: 0,
    start_date: null,
    end_date: null,
    status: 'aktiv',
    status_override: null,
    notes: null,
    category: null,
    work_type: 'project',
    billing_type: 'billable',
    source_project_id: null,
    ...p,
  }
}
function mkAssignment(projectId: number, start: string, end: string): Assignment {
  return {
    id: seq++,
    resource_id: 1,
    project_id: projectId,
    start_date: start,
    end_date: end,
    note: null,
    resource_name: 'Resurs',
    resource_type: 'anstalld',
    project_number: '',
    project_name: '',
  }
}

describe('Pågående idag', () => {
  it('räknar ett projekt en gång även med flera anställda', () => {
    const p = mkProject()
    const assignments = [
      mkAssignment(p.id, at(-1), at(2)),
      mkAssignment(p.id, at(0), at(5)),
    ]
    expect(getActiveProjectsToday(assignments, [p], TODAY)).toBe(1)
    expect(getActiveTodayProjects(assignments, [p], TODAY)).toHaveLength(1)
  })

  it('projekt som började igår och slutar imorgon pågår idag', () => {
    const p = mkProject()
    const a = [mkAssignment(p.id, at(-1), at(1))]
    expect(getActiveProjectsToday(a, [p], TODAY)).toBe(1)
  })

  it('avslutat projekt räknas inte', () => {
    const p = mkProject({ status: 'avslutad' })
    const a = [mkAssignment(p.id, at(-1), at(1))]
    expect(getActiveProjectsToday(a, [p], TODAY)).toBe(0)
  })
})

describe('Produktion 30 dagar', () => {
  it('bokning 31 dagar fram räknas inte, 29 dagar fram räknas', () => {
    const inside = mkProject({ sum: 100 })
    const outside = mkProject({ sum: 200 })
    const a = [
      mkAssignment(inside.id, at(29), at(35)),
      mkAssignment(outside.id, at(31), at(40)),
    ]
    const ids = getUpcomingScheduledProjects(a, [inside, outside], TODAY).map((p) => p.id)
    expect(ids).toEqual([inside.id])
    // Bokningen är 7 dagar (29–35), varav 2 (29–30) ligger inom fönstret →
    // 100 * 2/7 ≈ 28.57, avrundat till 29. Se "prorata värdet..."-testet nedan
    // för det generella fallet.
    expect(getUpcomingScheduledValue(a, [inside, outside], TODAY)).toBe(29)
  })

  it('bokning som började före idag men överlappar idag räknas', () => {
    const p = mkProject({ sum: 500 })
    const a = [mkAssignment(p.id, at(-10), at(2))]
    // Bokningen är 13 dagar (-10–2), varav 3 (0–2) ligger inom fönstret →
    // 500 * 3/13 ≈ 115.38, avrundat till 115.
    expect(getUpcomingScheduledValue(a, [p], TODAY)).toBe(115)
  })

  it('projekt med flera bokningar räknas bara en gång per dag i värdet', () => {
    const p = mkProject({ sum: 500 })
    const a = [mkAssignment(p.id, at(1), at(3)), mkAssignment(p.id, at(10), at(12))]
    // Båda bokningarna (6 dagar totalt) ligger helt inom fönstret → full summa.
    expect(getUpcomingScheduledValue(a, [p], TODAY)).toBe(500)
  })

  it('prorata värdet efter andel bokade dagar inom fönstret, inte hela projektsumman', () => {
    // Stort, långt projekt med bara en kort bokning nära i tiden ska INTE dra
    // in hela projektsumman i "Produktion 30 dagar" – det var precis buggen.
    const p = mkProject({ sum: 3_000_000 })
    const a = [mkAssignment(p.id, at(5), at(6))] // 2 bokade dagar totalt, båda inom fönstret
    expect(getUpcomingScheduledValue(a, [p], TODAY)).toBe(3_000_000)

    // Samma projekt, men bokningen sträcker sig långt utanför fönstret också →
    // bara andelen av de bokade dagarna som faller inom fönstret räknas.
    const long = mkProject({ sum: 3_000_000 })
    const b = [mkAssignment(long.id, at(5), at(104))] // 100 bokade dagar, 26 inom fönstret (5–30)
    expect(getUpcomingScheduledValue(b, [long], TODAY)).toBe(Math.round(3_000_000 * (26 / 100)))
  })

  it('överlappande bokningar (flera anställda samma dagar) dubbelräknas inte som bokade dagar', () => {
    const p = mkProject({ sum: 1000 })
    // Två anställda bokade exakt samma 10 dagar, alla inom fönstret → union = 10
    // bokade dagar, inte 20 – annars skulle värdet halveras felaktigt.
    const a = [mkAssignment(p.id, at(0), at(9)), mkAssignment(p.id, at(0), at(9))]
    expect(getUpcomingScheduledValue(a, [p], TODAY)).toBe(1000)
  })
})

describe('Signerat framåt vs Försenad start', () => {
  it('obemannat projekt med framtida preliminär start = Signerat framåt, inte Försenad', () => {
    const p = mkProject({ sum: 350_000, start_date: at(20) })
    const signed = getFutureSignedProjects([], [p], TODAY)
    const delayed = getDelayedStartProjects([], [p], TODAY)
    expect(signed.map((x) => x.id)).toEqual([p.id])
    expect(delayed).toHaveLength(0)
  })

  it('obemannat projekt vars preliminära start passerat = Försenad start, inte Signerat framåt', () => {
    const p = mkProject({ sum: 350_000, start_date: at(-5) })
    expect(getFutureSignedProjects([], [p], TODAY)).toHaveLength(0)
    expect(getDelayedStartProjects([], [p], TODAY).map((x) => x.id)).toEqual([p.id])
  })

  it('projekt vars planering passerat är klart att fakturera, inte försenad start', () => {
    const p = mkProject({ status: 'klar_att_fakturera', sum: 100, start_date: at(-30) })
    const a = [mkAssignment(p.id, at(-10), at(-2))]
    expect(projectHasCurrentOrFutureAssignment(a, p.id, TODAY)).toBe(false)
    expect(getFutureSignedProjects(a, [p], TODAY)).toHaveLength(0)
    expect(getDelayedStartProjects(a, [p], TODAY)).toHaveLength(0)
  })

  it('projekt med framtida bokning räknas inte som orderstock', () => {
    const p = mkProject({ sum: 100, start_date: at(2) })
    const a = [mkAssignment(p.id, at(2), at(8))]
    expect(getFutureSignedProjects(a, [p], TODAY)).toHaveLength(0)
    expect(getDelayedStartProjects(a, [p], TODAY)).toHaveLength(0)
  })

  it('avslutat projekt räknas inte', () => {
    const p = mkProject({ status: 'avslutad', sum: 100, start_date: at(10) })
    expect(getFutureSignedProjects([], [p], TODAY)).toHaveLength(0)
    expect(getDelayedStartProjects([], [p], TODAY)).toHaveLength(0)
  })

  it('projekt utan startdatum räknas som orderstock, inte som försenat', () => {
    const p = mkProject({ sum: 100 })
    expect(getFutureSignedProjects([], [p], TODAY).map((x) => x.id)).toEqual([p.id])
    expect(getDelayedStartProjects([], [p], TODAY)).toHaveLength(0)
  })
})

describe('Saknar bemanning', () => {
  it('obemannat projekt som startar inom 7 dagar flaggas', () => {
    const p = mkProject({ start_date: at(3) })
    expect(getUnstaffedUpcomingProjects([], [p], TODAY).map((x) => x.id)).toEqual([p.id])
  })

  it('projekt med framtida bokning flaggas inte', () => {
    const p = mkProject({ start_date: at(3) })
    const a = [mkAssignment(p.id, at(3), at(9))]
    expect(getUnstaffedUpcomingProjects(a, [p], TODAY)).toHaveLength(0)
  })

  it('projekt som startar om 10 dagar flaggas inte (utanför 7-dagarsfönstret)', () => {
    const p = mkProject({ start_date: at(10) })
    expect(getUnstaffedUpcomingProjects([], [p], TODAY)).toHaveLength(0)
  })

  it('projekt som är klart att fakturera flaggas inte', () => {
    const p = mkProject({ status: 'klar_att_fakturera', start_date: at(3) })
    expect(getUnstaffedUpcomingProjects([], [p], TODAY)).toHaveLength(0)
    expect(getDelayedStartProjects([], [p], TODAY)).toHaveLength(0)
  })
})

describe('Avdelningsfilter', () => {
  it('påverkar samtliga KPI:er via projekturvalet', () => {
    const mark = mkProject({ category: 'mark', sum: 100, start_date: at(10) })
    const fasad = mkProject({ category: 'fasad', sum: 200, start_date: at(10) })
    const all = [mark, fasad]

    const filtered = filterProjectsByDepartment(all, 'mark')
    expect(filtered).toEqual([mark])
    expect(getFutureSignedProjects([], filtered, TODAY).map((p) => p.id)).toEqual([mark.id])
    expect(filterProjectsByDepartment(all, '')).toEqual(all)
  })
})

describe('compareProjects – naturlig sortering av projektnummer', () => {
  it('sorterar 26-9 < 26-10 < 26-100', () => {
    const nums = ['26-100', '26-9', '26-10']
    const sorted = nums
      .map((n) => mkProject({ project_number: n }))
      .sort((a, b) => compareProjects([], a, b, 'project_number'))
      .map((p) => p.project_number)
    expect(sorted).toEqual(['26-9', '26-10', '26-100'])
  })
})
