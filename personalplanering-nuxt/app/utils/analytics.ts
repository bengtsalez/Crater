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

// ---------- Översikt/analytics-beräkningar ----------

export function filterProjectsByDepartment(projects: Project[], dept: string): Project[] {
  return dept ? projects.filter((p) => p.category === dept) : projects
}

export function projectHasStaff(assignments: Assignment[], projectId: number): boolean {
  return assignments.some((a) => a.project_id === projectId)
}

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

// project_id-Set för ej avslutade projekt med minst en assignment som överlappar [fromISO, toISO].
function projectIdsWithAssignmentInWindow(
  assignments: Assignment[],
  projects: Project[],
  fromISO: string,
  toISO: string
): Set<number> {
  const eligible = new Set(projects.filter((p) => p.status !== 'avslutad').map((p) => p.id))
  const ids = new Set<number>()
  for (const a of assignments) {
    if (eligible.has(a.project_id) && a.start_date <= toISO && a.end_date >= fromISO) {
      ids.add(a.project_id)
    }
  }
  return ids
}

// KPI 1: hela projektsumman för ej avslutade projekt som har minst en assignment
// som överlappar [idag, idag+N dagar].
export function getUpcomingScheduledValue(assignments: Assignment[], projects: Project[], today: Date): number {
  const from = toISO(today)
  const to = toISO(addDays(today, ANALYTICS_UPCOMING_WINDOW_DAYS))
  const ids = projectIdsWithAssignmentInWindow(assignments, projects, from, to)
  const byId = new Map(projects.map((p) => [p.id, p]))
  return [...ids].reduce((sum, id) => sum + (byId.get(id)?.sum || 0), 0)
}

// KPI 2: framtida orderstock = summan för ej avslutade projekt som saknar bokad personal.
export function getFutureSignedValue(assignments: Assignment[], projects: Project[]): number {
  return projects
    .filter((p) => p.status !== 'avslutad' && !projectHasStaff(assignments, p.id))
    .reduce((sum, p) => sum + (p.sum || 0), 0)
}

// KPI 3: antal unika ej avslutade projekt med minst en assignment som pågår idag.
export function getActiveProjectsToday(assignments: Assignment[], projects: Project[], today: Date): number {
  const t = toISO(today)
  return projectIdsWithAssignmentInWindow(assignments, projects, t, t).size
}

// KPI 4: ej avslutade projekt som startar inom bemanningsfönstret och saknar bokad personal.
export function getUnstaffedUpcomingProjects(assignments: Assignment[], projects: Project[], today: Date): Project[] {
  return projectsStartingWithin(
    assignments,
    projects.filter((p) => p.status !== 'avslutad' && !projectHasStaff(assignments, p.id)),
    today,
    ANALYTICS_UNSTAFFED_LEAD_DAYS
  ).sort((a, b) =>
    (effectiveStart(assignments, a).date || '').localeCompare(effectiveStart(assignments, b).date || '')
  )
}

// Sortjämförelse för projektlistan.
export function compareProjects(assignments: Assignment[], a: Project, b: Project, field: string): number {
  if (field === 'sum') {
    return (a.sum ?? -Infinity) - (b.sum ?? -Infinity)
  }
  if (field === 'start_date') {
    return String(effectiveStart(assignments, a).date ?? '').localeCompare(
      String(effectiveStart(assignments, b).date ?? '')
    )
  }
  const av = String((a as unknown as Record<string, unknown>)[field] ?? '').toLowerCase()
  const bv = String((b as unknown as Record<string, unknown>)[field] ?? '').toLowerCase()
  return av.localeCompare(bv)
}
