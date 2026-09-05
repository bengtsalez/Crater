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
    project_manager_user_id: null,
    project_manager_username: null,
    sum: 0,
    start_date: null,
    end_date: null,
    status: 'aktiv',
    status_override: null,
    notes: null,
    category: null,
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
    expect(getUpcomingScheduledValue(a, [inside, outside], TODAY)).toBe(100)
  })

  it('bokning som började före idag men överlappar idag räknas', () => {
    const p = mkProject({ sum: 500 })
    const a = [mkAssignment(p.id, at(-10), at(2))]
    expect(getUpcomingScheduledValue(a, [p], TODAY)).toBe(500)
  })

  it('projekt med flera bokningar räknas bara en gång i värdet', () => {
    const p = mkProject({ sum: 500 })
    const a = [mkAssignment(p.id, at(1), at(3)), mkAssignment(p.id, at(10), at(12))]
    expect(getUpcomingScheduledValue(a, [p], TODAY)).toBe(500)
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

  it('historisk bokning ger inte framtida bemanning – projektet hamnar i Försenad start', () => {
    const p = mkProject({ sum: 100, start_date: at(-30) })
    const a = [mkAssignment(p.id, at(-10), at(-2))]
    expect(projectHasCurrentOrFutureAssignment(a, p.id, TODAY)).toBe(false)
    expect(getFutureSignedProjects(a, [p], TODAY)).toHaveLength(0)
    expect(getDelayedStartProjects(a, [p], TODAY).map((x) => x.id)).toEqual([p.id])
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
