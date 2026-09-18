import { describe, it, expect } from 'vitest'
import {
  buildProjectUpdateEvent,
  buildCustomerUpdateEvent,
  buildLineItemUpdateEvent,
  buildTaskUpdateEvents,
  buildAssignmentRescheduleEvent,
  type ProjectDiffRow,
  type CustomerDiffRow,
  type LineItemDiffRow,
  type TaskDiffRow,
  type AssignmentDiffRow,
} from './activityDiff'

describe('buildProjectUpdateEvent', () => {
  const base: ProjectDiffRow = {
    name: 'Projekt A',
    start_date: '2026-10-06',
    end_date: '2026-11-01',
    sum: 100000,
    notes: null,
    category: 'mark',
    billing_type: 'billable',
    status_override: null,
    customer_name: 'Kund A',
    project_manager_username: 'dan',
  }

  it('returnerar null om inget fält ändrats', () => {
    expect(buildProjectUpdateEvent(base, {})).toBeNull()
    expect(buildProjectUpdateEvent(base, { name: base.name })).toBeNull()
  })

  it('returnerar ett event med en enda ändring vid ett ändrat fält', () => {
    const result = buildProjectUpdateEvent(base, { start_date: '2026-10-13' })
    expect(result).toEqual({
      eventType: 'project.updated',
      metadata: { changes: [{ field: 'start_date', old_value: '2026-10-06', new_value: '2026-10-13' }] },
    })
  })

  it('grupperar flera ändrade fält i samma event', () => {
    const result = buildProjectUpdateEvent(base, {
      start_date: '2026-10-13',
      project_manager_username: 'henrik',
    })
    expect(result?.eventType).toBe('project.updated')
    const changes = result?.metadata.changes as unknown[]
    expect(changes).toHaveLength(2)
  })

  it('behandlar null och tom sträng som samma "tomt" värde – inget brus när ett oförändrat tomt fält skickas om', () => {
    const withNullNotes: ProjectDiffRow = { ...base, notes: null }
    // Formuläret skickar alltid notes.trim() (aldrig null) – ett sparat tomt fält
    // ska INTE räknas som en ändring bara för att representationen skiljer sig.
    const result = buildProjectUpdateEvent(withNullNotes, { notes: '' })
    expect(result).toBeNull()
  })

  it('loggar fortfarande en riktig ändring från tomt till ifyllt', () => {
    const withNullNotes: ProjectDiffRow = { ...base, notes: null }
    const result = buildProjectUpdateEvent(withNullNotes, { notes: 'Viktig info' })
    expect(result?.metadata.changes).toEqual([{ field: 'notes', old_value: null, new_value: 'Viktig info' }])
  })
})

describe('buildCustomerUpdateEvent', () => {
  const base: CustomerDiffRow = {
    name: 'Kund A',
    customer_type: null,
    organization_number: null,
    contact_person: 'Gammal Kontakt',
    email: null,
    phone: '070-0000000',
    mobile: null,
    address: null,
    postal_code: null,
    city: null,
    billing_address: null,
    billing_postal_code: null,
    billing_city: null,
    billing_email: 'old@x.se',
    invoice_reference: null,
    notes: null,
  }

  it('returnerar null om inget ändrats', () => {
    expect(buildCustomerUpdateEvent(base, {})).toBeNull()
  })

  it('grupperar flera samtidigt ändrade fakturafält i ett event', () => {
    const result = buildCustomerUpdateEvent(base, {
      billing_email: 'new@x.se',
      billing_address: 'Storgatan 1',
    })
    expect(result?.eventType).toBe('customer.updated')
    expect(result?.metadata.changes).toHaveLength(2)
  })
})

describe('buildLineItemUpdateEvent', () => {
  const ata: LineItemDiffRow = { type: 'ata', description: 'Extra markarbete', amount: 24500, date: null, notes: null }
  const utgift: LineItemDiffRow = { type: 'utgift', description: 'Material', amount: 8450, date: null, notes: null }

  it('returnerar null om inget ändrats', () => {
    expect(buildLineItemUpdateEvent(ata, {})).toBeNull()
  })

  it('taggar ata-rader som line_item.ata_updated', () => {
    const result = buildLineItemUpdateEvent(ata, { amount: 31000 })
    expect(result?.eventType).toBe('line_item.ata_updated')
  })

  it('taggar utgifts-rader som line_item.expense_updated', () => {
    const result = buildLineItemUpdateEvent(utgift, { amount: 9000 })
    expect(result?.eventType).toBe('line_item.expense_updated')
  })
})

describe('buildTaskUpdateEvents', () => {
  const base: TaskDiffRow = { title: 'Beställ ställning', status: 'aktiv', due_date: '2026-10-01' }

  it('returnerar tomt om inget relevant ändrats', () => {
    expect(buildTaskUpdateEvents(base, {})).toEqual([])
  })

  it('loggar task.completed när status går till avslutad', () => {
    const events = buildTaskUpdateEvents(base, { status: 'avslutad' })
    expect(events).toEqual([{ eventType: 'task.completed', metadata: { title: base.title } }])
  })

  it('loggar task.reopened när status lämnar avslutad', () => {
    const closed: TaskDiffRow = { ...base, status: 'avslutad' }
    const events = buildTaskUpdateEvents(closed, { status: 'aktiv' })
    expect(events).toEqual([{ eventType: 'task.reopened', metadata: { title: base.title } }])
  })

  it('loggar bara förfallodatum-ändring separat', () => {
    const events = buildTaskUpdateEvents(base, { due_date: '2026-10-15' })
    expect(events).toEqual([
      { eventType: 'task.due_date_changed', metadata: { title: base.title, old_value: '2026-10-01', new_value: '2026-10-15' } },
    ])
  })

  it('kan returnera både status- och datumhändelse samtidigt', () => {
    const events = buildTaskUpdateEvents(base, { status: 'avslutad', due_date: '2026-10-15' })
    expect(events).toHaveLength(2)
  })
})

describe('buildAssignmentRescheduleEvent', () => {
  const base: AssignmentDiffRow = { start_date: '2026-10-06', end_date: '2026-10-10', resource_id: 1, project_id: 42 }

  it('returnerar null om inget ändrats', () => {
    expect(buildAssignmentRescheduleEvent(base, { ...base }, 'Kalle Andersson')).toBeNull()
  })

  it('fångar en ombokning av bara datum', () => {
    const result = buildAssignmentRescheduleEvent(
      base,
      { ...base, start_date: '2026-10-13', end_date: '2026-10-17' },
      'Kalle Andersson'
    )
    expect(result?.eventType).toBe('assignment.rescheduled')
    expect(result?.metadata).toMatchObject({
      old_start_date: '2026-10-06',
      new_start_date: '2026-10-13',
      resource_changed: false,
      project_changed: false,
    })
  })

  it('flaggar resursbyte', () => {
    const result = buildAssignmentRescheduleEvent(base, { ...base, resource_id: 2 }, 'Ny Resurs')
    expect(result?.metadata.resource_changed).toBe(true)
  })

  it('flaggar projektbyte', () => {
    const result = buildAssignmentRescheduleEvent(base, { ...base, project_id: 99 }, 'Kalle Andersson')
    expect(result?.metadata.project_changed).toBe(true)
  })
})
