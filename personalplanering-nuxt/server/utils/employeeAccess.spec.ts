import { describe, expect, it } from 'vitest'
import { isAccountantAllowedPath, isEmployeeAllowedPath, normalizeApiPath, pickCustomerFieldsForStaff } from './employeeAccess'

describe('isEmployeeAllowedPath', () => {
  it('släpper igenom personalens endpoints', () => {
    for (const p of ['/api/me', '/api/logout', '/api/employee/jobs', '/api/employee/jobs/12', '/api/employee/tasks/3?x=1']) {
      expect(isEmployeeAllowedPath(p), p).toBe(true)
    }
  })

  it('nekar alla interna endpoints', () => {
    for (const p of [
      '/api/projects', '/api/projects/1', '/api/projects/1/line-items', '/api/projects/1/tasks', '/api/projects/1/staff-info',
      '/api/customers', '/api/customers/1', '/api/users', '/api/users/2', '/api/resources', '/api/assignments',
      '/api/tasks', '/api/tasks/1', '/api/line-items/1', '/api/departments', '/api/org', '/api/onboarding',
      '/api/onboarding/complete', '/api/employee', '/api/employee/', '/api/employees/x', '/api/me/x',
    ]) {
      expect(isEmployeeAllowedPath(p), p).toBe(false)
    }
  })

  it('kan inte kringgås med sökvägstrick', () => {
    for (const p of [
      '/api/employee/../projects', '/api/employee/%2e%2e/projects', '/api/employee/%2E%2E/users',
      '/api/employee/jobs/../../customers', '//api/projects', '/API/PROJECTS', '/api/employee/..%2fprojects',
      '/api/employee\\..\\projects', '/api/employee/%zz',
    ]) {
      expect(isEmployeeAllowedPath(p), p).toBe(false)
    }
  })

  it('normaliserar', () => {
    expect(normalizeApiPath('//api//employee/./jobs/')).toBe('/api/employee/jobs')
    expect(normalizeApiPath('/api/%zz')).toBeNull()
  })
})

describe('pickCustomerFieldsForStaff', () => {
  it('släpper bara tillåtna fält', () => {
    const out = pickCustomerFieldsForStaff({
      name: 'Kund', contact_person: 'Kalle', phone: '1', mobile: '', address: 'Gata', postal_code: '1', city: 'X',
      organization_number: '556', email: 'a@b', billing_address: 'F', invoice_reference: 'R', notes: 'hemligt', id: 5, org_id: 1,
    })
    expect(out).toEqual({ name: 'Kund', contact_person: 'Kalle', phone: '1', mobile: null, address: 'Gata', postal_code: '1', city: 'X' })
    expect(pickCustomerFieldsForStaff(null)).toBeNull()
  })
})

describe('isAccountantAllowedPath', () => {
  it('släpper igenom redovisningsvyns endpoints', () => {
    for (const p of ['/api/me', '/api/logout', '/api/accountant/projects', '/api/accountant/projects/12']) {
      expect(isAccountantAllowedPath(p), p).toBe(true)
    }
  })

  it('nekar interna och personalens endpoints samt sökvägstrick', () => {
    for (const p of [
      '/api/projects', '/api/projects/1', '/api/projects/1/line-items', '/api/customers', '/api/customers/1',
      '/api/users', '/api/org', '/api/employee/jobs', '/api/accountant', '/api/accountant/',
      '/api/accountant/../projects', '/api/accountant/%2e%2e/users', '//api/customers', '/api/accountant/%zz',
    ]) {
      expect(isAccountantAllowedPath(p), p).toBe(false)
    }
  })

  it('personal kommer inte åt redovisningsvyn', () => {
    expect(isEmployeeAllowedPath('/api/accountant/projects')).toBe(false)
  })
})
