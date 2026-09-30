import { describe, expect, it } from 'vitest'
import type { EmployeeJob } from '../types'
import { customerAddress, mapsUrl, periodRange, remainingTasksLabel, sameAddress, splitJobs, telHref } from './employeeJobs'

const job = (id: number, start: string, end: string, projectId = 1): EmployeeJob => ({
  assignment_id: id,
  start_date: start,
  end_date: end,
  note: null,
  project_id: projectId,
  project_number: 'P' + projectId,
  project_name: 'Projekt',
  site_address: null,
  work_type: 'project',
  remaining_tasks: 0,
})

describe('splitJobs', () => {
  it('delar i idag/kommande och sorterar på startdatum', () => {
    const { today, upcoming } = splitJobs(
      [job(3, '2026-10-10', '2026-10-12'), job(1, '2026-09-29', '2026-10-01'), job(2, '2026-10-02', '2026-10-02')],
      '2026-09-30'
    )
    expect(today.map((j) => j.assignment_id)).toEqual([1])
    expect(upcoming.map((j) => j.assignment_id)).toEqual([2, 3])
  })

  it('flera bokningar på samma projekt blir separata kort', () => {
    const { upcoming } = splitJobs([job(1, '2026-10-05', '2026-10-06'), job(2, '2026-10-01', '2026-10-01')], '2026-09-30')
    expect(upcoming.map((j) => j.assignment_id)).toEqual([2, 1])
  })

  it('bokning som slutar eller börjar idag räknas som idag', () => {
    const { today } = splitJobs([job(1, '2026-09-28', '2026-09-30'), job(2, '2026-09-30', '2026-10-03')], '2026-09-30')
    expect(today).toHaveLength(2)
  })
})

describe('periodRange', () => {
  it('denna och nästa vecka är mån–sön', () => {
    expect(periodRange('this_week', '2026-09-30')).toEqual({ from: '2026-09-28', to: '2026-10-04' })
    expect(periodRange('next_week', '2026-09-30')).toEqual({ from: '2026-10-05', to: '2026-10-11' })
    expect(periodRange('this_week', '2026-10-04')).toEqual({ from: '2026-09-28', to: '2026-10-04' })
  })
  it('eget intervall kräver båda datumen och vänds om det är baklänges', () => {
    expect(periodRange('custom', '2026-09-30', { from: '2026-10-01' })).toBeNull()
    expect(periodRange('custom', '2026-09-30', { from: '2026-10-09', to: '2026-10-01' })).toEqual({ from: '2026-10-01', to: '2026-10-09' })
  })
  it('kommande har inget intervall', () => {
    expect(periodRange('upcoming', '2026-09-30')).toBeNull()
  })
})

describe('adresser och länkar', () => {
  it('kundadress byggs av delar och jämförs normaliserat', () => {
    const addr = customerAddress({ address: 'Storgatan 1', postal_code: '211 22', city: 'Malmö' })
    expect(addr).toBe('Storgatan 1, 211 22 Malmö')
    expect(sameAddress(addr, 'storgatan 1 211 22 malmö')).toBe(true)
    expect(sameAddress(addr, 'Lillgatan 2')).toBe(false)
    expect(sameAddress('', '')).toBe(false)
    expect(customerAddress({ address: null, postal_code: null, city: null })).toBe('')
  })
  it('kartlänk kodar adressen', () => {
    expect(mapsUrl('Gatan 1 & 2')).toContain('query=Gatan%201%20%26%202')
  })
  it('tel-länk rensar formatering och saknas utan nummer', () => {
    expect(telHref('070-123 45 67')).toBe('tel:0701234567')
    expect(telHref('+46 70 123')).toBe('tel:+4670123')
    expect(telHref('')).toBeNull()
    expect(telHref(null)).toBeNull()
    expect(telHref('saknas')).toBeNull()
  })
  it('uppgiftsetikett', () => {
    expect(remainingTasksLabel(0)).toBe('Inga uppgifter kvar')
    expect(remainingTasksLabel(1)).toBe('1 uppgift kvar')
    expect(remainingTasksLabel(3)).toBe('3 uppgifter kvar')
  })
})
