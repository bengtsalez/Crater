import { describe, expect, it } from 'vitest'
import type { AccountantProject } from '../types'
import { accountantProjectsCsv, filterAccountantProjects, sumProjects } from './accountant'

const base: AccountantProject = {
  id: 1, project_number: '1001', name: 'Dränering', status: 'klar_att_fakturera', work_type: 'project',
  billing_type: 'billable', sum: 125000.5, start_date: '2026-09-01', end_date: '2026-09-20', site_address: null,
  project_manager_username: 'henrik', customer_id: 1, customer_name: 'Brinova AB', customer_organization_number: '556000-0000',
  customer_city: 'Malmö', ata_total: 5000, expense_total: 1200,
}
const projects: AccountantProject[] = [
  base,
  { ...base, id: 2, project_number: '1002', name: 'Garanti; "tak"', status: 'avslutad', work_type: 'small_job', billing_type: 'warranty', sum: null, customer_name: 'Villa Ek', customer_organization_number: null, ata_total: 0, expense_total: 300 },
  { ...base, id: 3, project_number: '1003', name: 'Schakt', status: 'planerad', customer_name: null },
]
const all = { query: '', status: 'all' as const, type: 'all' as const }

describe('filterAccountantProjects', () => {
  it('filtrerar på status, typ och "ej avslutade"', () => {
    expect(filterAccountantProjects(projects, { ...all, status: 'klar_att_fakturera' }).map((p) => p.id)).toEqual([1])
    expect(filterAccountantProjects(projects, { ...all, status: 'open' }).map((p) => p.id)).toEqual([1, 3])
    expect(filterAccountantProjects(projects, { ...all, type: 'small_job' }).map((p) => p.id)).toEqual([2])
  })

  it('söker i nummer, namn, kund och org.nr', () => {
    expect(filterAccountantProjects(projects, { ...all, query: 'brinova' }).map((p) => p.id)).toEqual([1])
    expect(filterAccountantProjects(projects, { ...all, query: '556000' }).map((p) => p.id)).toEqual([1, 3])
    expect(filterAccountantProjects(projects, { ...all, query: '1002' }).map((p) => p.id)).toEqual([2])
  })
})

describe('sumProjects', () => {
  it('summerar belopp (null = 0), ÄTA och utgifter', () => {
    expect(sumProjects(projects)).toEqual({ sum: 250001, ata: 10000, expense: 2700 })
  })
})

describe('accountantProjectsCsv', () => {
  it('ger svensk Excel-CSV med BOM, semikolon, decimalkomma och citering', () => {
    const csv = accountantProjectsCsv(projects.slice(0, 2))
    expect(csv.startsWith('﻿Projektnummer;Namn;')).toBe(true)
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('1001;Dränering;Projekt;Debiterbart;Klar att fakturera;Brinova AB;556000-0000;Malmö;125000,5;5000;1200;2026-09-01;2026-09-20;henrik')
    expect(lines[2]).toContain(';"Garanti; ""tak""";Ströjobb;Garanti;Avslutad;Villa Ek;;Malmö;;0;300;')
  })
})
