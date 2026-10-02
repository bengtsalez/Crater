import type { AccountantProject } from '../types'
import { STATUS_LABELS } from './constants'
import { BILLING_TYPE_LABELS } from './projects'

// Ren logik för redovisningsvyn (Nuxt/Vue-fri så att den kan enhetstestas).

export type AccountantStatusFilter = 'all' | 'open' | 'aktiv' | 'planerad' | 'klar_att_fakturera' | 'avslutad'
export type AccountantTypeFilter = 'all' | 'project' | 'small_job'

export function workTypeLabel(p: Pick<AccountantProject, 'work_type'>): string {
  return p.work_type === 'small_job' ? 'Ströjobb' : 'Projekt'
}

export interface AccountantFilter {
  query: string
  status: AccountantStatusFilter
  type: AccountantTypeFilter
}

export function filterAccountantProjects(projects: AccountantProject[], f: AccountantFilter): AccountantProject[] {
  const q = f.query.trim().toLowerCase()
  return projects.filter((p) => {
    if (f.type !== 'all' && p.work_type !== f.type) return false
    if (f.status === 'open' && p.status === 'avslutad') return false
    if (f.status !== 'all' && f.status !== 'open' && p.status !== f.status) return false
    if (!q) return true
    return [p.project_number, p.name, p.customer_name, p.customer_organization_number, p.customer_city, p.project_manager_username]
      .some((v) => v && v.toLowerCase().includes(q))
  })
}

export function sumProjects(projects: AccountantProject[]) {
  return projects.reduce(
    (acc, p) => ({
      sum: acc.sum + (p.sum ?? 0),
      ata: acc.ata + p.ata_total,
      expense: acc.expense + p.expense_total,
    }),
    { sum: 0, ata: 0, expense: 0 }
  )
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v)
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Semikolon + decimalkomma + BOM = öppnas rätt i svenskt Excel.
export function accountantProjectsCsv(projects: AccountantProject[]): string {
  const header = [
    'Projektnummer', 'Namn', 'Typ', 'Debitering', 'Status', 'Kund', 'Org.nr', 'Ort',
    'Belopp', 'ÄTA', 'Utgifter', 'Start', 'Slut', 'Projektledare',
  ]
  const rows = projects.map((p) => [
    p.project_number, p.name, workTypeLabel(p), BILLING_TYPE_LABELS[p.billing_type] ?? p.billing_type,
    STATUS_LABELS[p.status] ?? p.status, p.customer_name, p.customer_organization_number, p.customer_city,
    p.sum, p.ata_total, p.expense_total, p.start_date, p.end_date, p.project_manager_username,
  ])
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n'
}
