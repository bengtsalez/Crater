import { describe, it, expect } from 'vitest'
import { formatSum, groupActivitiesByDay } from './format'

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

describe('formatSum', () => {
  it('formaterar ett belopp med svensk tusentalsavgränsare och kr-suffix', () => {
    expect(formatSum(18400)).toBe('18 400 kr')
  })

  it('visar tankstreck för saknat värde', () => {
    expect(formatSum(null)).toBe('–')
    expect(formatSum(undefined)).toBe('–')
    expect(formatSum('')).toBe('–')
  })
})

describe('groupActivitiesByDay', () => {
  it('grupperar i Idag/Igår/Denna vecka/Äldre', () => {
    const items = [
      { id: 1, created_at: isoDaysAgo(0) },
      { id: 2, created_at: isoDaysAgo(1) },
      { id: 3, created_at: isoDaysAgo(3) },
      { id: 4, created_at: isoDaysAgo(30) },
    ]
    const groups = groupActivitiesByDay(items)
    expect(groups.map((g) => g.bucket)).toEqual(['today', 'yesterday', 'this_week', 'older'])
    expect(groups.map((g) => g.label)).toEqual(['Idag', 'Igår', 'Denna vecka', 'Äldre'])
    expect(groups[0]!.items).toEqual([items[0]])
  })

  it('utelämnar tomma hinkar', () => {
    const items = [{ id: 1, created_at: isoDaysAgo(0) }]
    const groups = groupActivitiesByDay(items)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.bucket).toBe('today')
  })

  it('returnerar tom lista för tom input', () => {
    expect(groupActivitiesByDay([])).toEqual([])
  })
})
