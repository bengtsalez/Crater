import { describe, it, expect } from 'vitest'
import { formatActivity } from './activity'
import type { ActivityEvent } from '../types'

const base: ActivityEvent = {
  id: 1,
  user_id: 5,
  actor_username: 'henrik',
  entity_type: 'project',
  entity_id: 10,
  project_id: 10,
  customer_id: null,
  event_type: 'project.created',
  metadata: {},
  created_at: '2026-10-06T10:00:00.000Z',
}

describe('formatActivity', () => {
  it('project.updated med ett fält visar ändrat-fält och pil mellan värden', () => {
    const e: ActivityEvent = {
      ...base,
      event_type: 'project.updated',
      metadata: { changes: [{ field: 'start_date', old_value: '2026-10-06', new_value: '2026-10-13' }] },
    }
    const display = formatActivity(e)
    expect(display.title).toBe('henrik ändrade byggstart')
    expect(display.secondary).toBe('2026-10-06 → 2026-10-13')
  })

  it('project.updated med flera fält grupperas till ett summerande event', () => {
    const e: ActivityEvent = {
      ...base,
      event_type: 'project.updated',
      metadata: {
        changes: [
          { field: 'start_date', old_value: 'a', new_value: 'b' },
          { field: 'end_date', old_value: 'c', new_value: 'd' },
          { field: 'notes', old_value: 'e', new_value: 'f' },
        ],
      },
    }
    const display = formatActivity(e)
    expect(display.title).toBe('henrik uppdaterade projektet (3 fält)')
  })

  it('line_item.ata_created formaterar belopp med formatSum', () => {
    const e: ActivityEvent = {
      ...base,
      event_type: 'line_item.ata_created',
      metadata: { description: 'Extra putsarbete', amount: 18400 },
    }
    expect(formatActivity(e).title).toBe('henrik skapade ÄTA "Extra putsarbete" på 18 400 kr')
  })

  it('task.completed', () => {
    const e: ActivityEvent = { ...base, event_type: 'task.completed', metadata: { title: 'Beställ ställning' } }
    expect(formatActivity(e).title).toBe('henrik markerade uppgiften "Beställ ställning" som klar')
  })

  it('assignment.rescheduled visar gammalt och nytt startdatum', () => {
    const e: ActivityEvent = {
      ...base,
      event_type: 'assignment.rescheduled',
      metadata: { resource_name: 'Kalle Andersson', old_start_date: '2026-10-06', new_start_date: '2026-10-13' },
    }
    const display = formatActivity(e)
    expect(display.title).toBe('henrik ändrade byggstart för Kalle Andersson')
    expect(display.secondary).toBe('2026-10-06 → 2026-10-13')
  })

  it('systemhändelse (user_id null) visas som avsändare "Crater"', () => {
    const e: ActivityEvent = {
      ...base,
      user_id: null,
      actor_username: null,
      event_type: 'project.status_changed',
      metadata: { old_value: 'planerad', new_value: 'klar_att_fakturera' },
    }
    expect(formatActivity(e).title).toBe('Crater ändrade status till Klar att fakturera')
  })

  it('okänd event_type faller tillbaka utan att krascha', () => {
    const e: ActivityEvent = { ...base, event_type: 'document.uploaded', metadata: {} }
    expect(formatActivity(e)).toEqual({ icon: 'i-lucide-activity', title: 'document.uploaded' })
  })
})
