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

// KPI 1: hela projektsumman för ej avslutade projekt som startar inom kommande N dagar.
export function getUpcomingScheduledValue(assignments: Assignment[], projects: Project[], today: Date): number {
  return projectsStartingWithin(
    assignments,
    projects.filter((p) => p.status !== 'avslutad'),
    today,
    ANALYTICS_UPCOMING_WINDOW_DAYS
  ).reduce((sum, p) => sum + (p.sum || 0), 0)
}

// KPI 2: framtida orderstock = summan för projekt med status "aktiv".
export function getFutureSignedValue(projects: Project[]): number {
  return projects.filter((p) => p.status === 'aktiv').reduce((sum, p) => sum + (p.sum || 0), 0)
}

// KPI 3: antal projekt med status "planerad".
export function getActiveProjectsToday(projects: Project[]): number {
  return projects.filter((p) => p.status === 'planerad').length
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
