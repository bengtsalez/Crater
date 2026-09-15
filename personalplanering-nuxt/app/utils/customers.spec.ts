import { describe, it, expect } from 'vitest'
import { normalizeCustomerName, projectCustomerName } from './customers'
import type { Project } from '../types'

describe('normalizeCustomerName', () => {
  it('trimmar och kollapsar whitespace', () => {
    expect(normalizeCustomerName('  Brinova   Fastigheter AB ')).toBe('brinova fastigheter ab')
  })

  it('är case-insensitive', () => {
    expect(normalizeCustomerName('BRINOVA')).toBe(normalizeCustomerName('brinova'))
  })

  it('slår inte ihop olika kundnamn – ingen fuzzy-matchning', () => {
    expect(normalizeCustomerName('Brinova')).not.toBe(normalizeCustomerName('Brinova Fastigheter AB'))
  })
})

describe('projectCustomerName', () => {
  const base: Project = {
    id: 1,
    project_number: 'P1',
    name: 'Projekt',
    client: null,
    customer_id: null,
    customer_name: null,
    project_manager_user_id: null,
    project_manager_username: null,
    sum: null,
    start_date: null,
    end_date: null,
    status: 'aktiv',
    status_override: null,
    notes: null,
    category: null,
    work_type: 'project',
    billing_type: 'billable',
    source_project_id: null,
  }

  it('föredrar customer_name framför client', () => {
    expect(projectCustomerName({ ...base, customer_name: 'Ny Kund', client: 'Gammal Kund' })).toBe('Ny Kund')
  })

  it('faller tillbaka på client om customer_name saknas (legacy)', () => {
    expect(projectCustomerName({ ...base, customer_name: null, client: 'Gammal Kund' })).toBe('Gammal Kund')
  })

  it('returnerar tom sträng om inget finns', () => {
    expect(projectCustomerName(base)).toBe('')
  })
})
