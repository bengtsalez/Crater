import type { Project } from '../types'
import { projectCustomerName } from './customers'

export function isSmallJob(p: Project): boolean {
  return p.work_type === 'small_job'
}

export function isBillableProject(p: Project): boolean {
  return p.billing_type === 'billable'
}

export const BILLING_TYPE_LABELS: Record<string, string> = {
  billable: 'Debiterbart',
  warranty: 'Garanti',
  internal: 'Internt',
}

// "SJ260014 · Garanti · Svensson" för ströjobb, "P1116 – Villa Andersson" för vanliga projekt.
export function projectDisplayLabel(p: Project): string {
  if (!isSmallJob(p)) return `${p.project_number} – ${p.name}`
  const parts = [p.project_number, BILLING_TYPE_LABELS[p.billing_type] || p.billing_type, projectCustomerName(p) || p.name]
  return parts.filter(Boolean).join(' · ')
}
