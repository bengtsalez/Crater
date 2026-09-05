import { toISO, addDays } from './dates'
import { ANALYTICS_UPCOMING_WINDOW_DAYS, ANALYTICS_UNSTAFFED_LEAD_DAYS } from './constants'
import type { Project, Assignment } from '../types'

export function isProjectPast(project: Project | null | undefined): boolean {
  return Boolean(project && project.end_date && project.end_date < toISO(new Date()))
}

// Tidigaste bokade startdatum för ett projekt, annars null.
export function plannedStartFor(assignments: Assignment[], projectId: number): string | null {
  return (
    assignments
      .filter((a) => a.project_id === projectId)
      .map((a) => a.start_date)
      .sort()[0] || null
  )
}

export interface EffectiveStart {
  date: string | null
  planned: boolean
  preliminary: string | null
}

// Vilket startdatum som gäller att visa: inplanerat om projektet har bokningar, annars preliminärt.
export function effectiveStart(assignments: Assignment[], project: Project): EffectiveStart {
  const planned = plannedStartFor(assignments, project.id)
  if (planned) return { date: planned, planned: true, preliminary: project.start_date || null }
  return { date: project.start_date || null, planned: false, preliminary: project.start_date || null }
}

// Projekt valbara i dropdowns: aktiva/planerade, plus ev. redan valt projekt.
export function activeProjectsForSelect(projects: Project[], currentId: number | null): Project[] {
  return projects.filter((p) => p.status !== 'avslutad' || p.id === currentId)
}

// ---------- Bemanningsstatus ----------
//
// Skilj tydligt mellan historisk, aktuell och framtida bemanning. "Har projektet
// någon assignment?" är inte samma sak som "är projektet bemannat framåt?".

// Datumlös: har projektet någonsin haft en bokning?
export function projectHasAnyAssignment(assignments: Assignment[], projectId: number): boolean {
  return assignments.some((a) => a.project_id === projectId)
}

// Minst en bokning som överlappar [fromISO, toISO].
export function projectHasAssignmentInWindow(
  assignments: Assignment[],
  projectId: number,
  fromISO: string,
  untilISO: string
): boolean {
  return assignments.some(
    (a) => a.project_id === projectId && a.start_date <= untilISO && a.end_date >= fromISO
  )
}

// Minst en bokning som pågår idag.
export function projectHasActiveAssignment(assignments: Assignment[], projectId: number, today: Date): boolean {
  const t = toISO(today)
  return projectHasAssignmentInWindow(assignments, projectId, t, t)
}

// Minst en bokning vars slutdatum är idag eller senare (bemannad nu eller framåt).
export function projectHasCurrentOrFutureAssignment(
  assignments: Assignment[],
  projectId: number,
  today: Date
): boolean {
  const t = toISO(today)
  return assignments.some((a) => a.project_id === projectId && a.end_date >= t)
}

// ---------- Översikt/analytics-beräkningar ----------

export function filterProjectsByDepartment(projects: Project[], dept: string): Project[] {
  return dept ? projects.filter((p) => p.category === dept) : projects
}

const notDone = (p: Project) => p.status !== 'avslutad'

// Projekt vars effektiva start ligger i [today, today+days].
export function projectsStartingWithin(
  assignments: Assignment[],
  projects: Project[],
  today: Date,
  days: number
): Project[] {
  const from = toISO(today)
  const to = toISO(addDays(today, days))
  return projects.filter((p) => {
    const start = effectiveStart(assignments, p).date
    return start && start >= from && start <= to
  })
}

export function projectValueSum(projects: Project[]): number {
  return projects.reduce((sum, p) => sum + (p.sum || 0), 0)
}

// KPI 1 ("Produktion 30 dagar"): ej avslutade projekt med minst en bokning som
// överlappar [idag, idag+N dagar]. Hela projektvärdet räknas en gång.
export function getUpcomingScheduledProjects(
  assignments: Assignment[],
  projects: Project[],
  today: Date
): Project[] {
  const from = toISO(today)
  const to = toISO(addDays(today, ANALYTICS_UPCOMING_WINDOW_DAYS))
  return projects.filter((p) => notDone(p) && projectHasAssignmentInWindow(assignments, p.id, from, to))
}

// KPI 2 ("Signerat framåt"): framtida orderstock = ej avslutade projekt utan
// nuvarande/framtida bemanning vars effektiva start ligger idag eller senare.
export function getFutureSignedProjects(
  assignments: Assignment[],
  projects: Project[],
  today: Date
): Project[] {
  const t = toISO(today)
  return projects.filter((p) => {
    if (!notDone(p) || projectHasCurrentOrFutureAssignment(assignments, p.id, today)) return false
    // Okänt startdatum = ännu ej planerat → räknas som framtida orderstock.
    const start = effectiveStart(assignments, p).date
    return !start || start >= t
  })
}

// KPI ("Försenad start"): ej avslutade, obemannade projekt vars effektiva start
// redan passerat – borde varit inplanerade.
export function getDelayedStartProjects(
  assignments: Assignment[],
  projects: Project[],
  today: Date
): Project[] {
  const t = toISO(today)
  return projects.filter((p) => {
    if (!notDone(p) || projectHasCurrentOrFutureAssignment(assignments, p.id, today)) return false
    const start = effectiveStart(assignments, p).date
    return !!start && start < t
  })
}

// KPI 3 ("Pågående idag"): ej avslutade projekt med minst en bokning som pågår idag.
export function getActiveTodayProjects(
  assignments: Assignment[],
  projects: Project[],
  today: Date
): Project[] {
  return projects.filter((p) => notDone(p) && projectHasActiveAssignment(assignments, p.id, today))
}

// KPI 4 ("Saknar bemanning"): ej avslutade projekt som startar inom
// bemanningsfönstret och saknar nuvarande/framtida bemanning.
export function getUnstaffedUpcomingProjects(
  assignments: Assignment[],
  projects: Project[],
  today: Date
): Project[] {
  return projectsStartingWithin(
    assignments,
    projects.filter(
      (p) => notDone(p) && !projectHasCurrentOrFutureAssignment(assignments, p.id, today)
    ),
    today,
    ANALYTICS_UNSTAFFED_LEAD_DAYS
  ).sort((a, b) =>
    (effectiveStart(assignments, a).date || '').localeCompare(effectiveStart(assignments, b).date || '')
  )
}

// Aggregatvärden – härleds ur respektive projektlista.
export function getUpcomingScheduledValue(assignments: Assignment[], projects: Project[], today: Date): number {
  return projectValueSum(getUpcomingScheduledProjects(assignments, projects, today))
}
export function getFutureSignedValue(assignments: Assignment[], projects: Project[], today: Date): number {
  return projectValueSum(getFutureSignedProjects(assignments, projects, today))
}
export function getActiveProjectsToday(assignments: Assignment[], projects: Project[], today: Date): number {
  return getActiveTodayProjects(assignments, projects, today).length
}

// Naturlig sortering (så att "26-9" < "26-10" < "26-100").
const collator = new Intl.Collator('sv', { numeric: true, sensitivity: 'base' })

// Sortjämförelse för projektlistan.
export function compareProjects(assignments: Assignment[], a: Project, b: Project, field: string): number {
  if (field === 'sum') {
    return (a.sum ?? -Infinity) - (b.sum ?? -Infinity)
  }
  if (field === 'start_date') {
    return collator.compare(
      String(effectiveStart(assignments, a).date ?? ''),
      String(effectiveStart(assignments, b).date ?? '')
    )
  }
  const av = String((a as unknown as Record<string, unknown>)[field] ?? '')
  const bv = String((b as unknown as Record<string, unknown>)[field] ?? '')
  return collator.compare(av, bv)
}
