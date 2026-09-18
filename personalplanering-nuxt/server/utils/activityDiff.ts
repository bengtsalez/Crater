// Ren affärslogik för aktivitetsloggen: avgör VILKET event (om något) en
// förändring motsvarar, och bygger dess metadata. Inga DB-anrop och inga
// beroenden på Nitros auto-imports (ingen apiError/createError/pool) – filen
// ska gå att importera och testa som vanlig TypeScript (se activityDiff.spec.ts).

export interface FieldChange {
  field: string
  old_value: unknown
  new_value: unknown
}

export interface ActivityDescriptor {
  eventType: string
  metadata: Record<string, unknown>
}

// Delad primitiv: jämför utvalda fält mellan `existing` och `next`. Ett fält
// som saknas i `next` räknas som oförändrat – anroparen ansvarar för att bara
// skicka in fält som faktiskt fanns i request-bodyn (matchar routernas
// `b.field ?? existing.field`-coalescing: `undefined` = rörs inte).
// null, undefined och '' räknas som samma "tomt" värde – annars skapar t.ex.
// ett formulär som alltid skickar `notes.trim()` (aldrig null) ett falskt
// "ändrade anteckningar"-brus varje gång ett OFÖRÄNDRAT tomt fält sparas om.
function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === ''
}

function diffFields<T>(existing: T, next: Partial<T>, fields: (keyof T & string)[]): FieldChange[] {
  const changes: FieldChange[] = []
  for (const field of fields) {
    if (!(field in next)) continue
    const oldValue = existing[field]
    const newValue = next[field]
    const changed = isEmpty(oldValue) && isEmpty(newValue) ? false : oldValue !== newValue
    if (changed) {
      changes.push({ field, old_value: oldValue ?? null, new_value: newValue ?? null })
    }
  }
  return changes
}

// ---- Project ----

export interface ProjectDiffRow {
  name: string
  start_date: string | null
  end_date: string | null
  sum: number | null
  notes: string | null
  category: string | null
  billing_type: string
  status_override: string | null
  customer_name: string | null
  project_manager_username: string | null
}

export function buildProjectUpdateEvent(
  existing: ProjectDiffRow,
  next: Partial<ProjectDiffRow>
): ActivityDescriptor | null {
  const changes = diffFields(existing, next, [
    'name',
    'start_date',
    'end_date',
    'sum',
    'notes',
    'category',
    'billing_type',
    'status_override',
    'customer_name',
    'project_manager_username',
  ])
  if (!changes.length) return null
  return { eventType: 'project.updated', metadata: { changes } }
}

// ---- Customer ----

export interface CustomerDiffRow {
  name: string
  customer_type: string | null
  organization_number: string | null
  contact_person: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  billing_address: string | null
  billing_postal_code: string | null
  billing_city: string | null
  billing_email: string | null
  invoice_reference: string | null
  notes: string | null
}

export function buildCustomerUpdateEvent(
  existing: CustomerDiffRow,
  next: Partial<CustomerDiffRow>
): ActivityDescriptor | null {
  const changes = diffFields(existing, next, [
    'name',
    'customer_type',
    'organization_number',
    'contact_person',
    'email',
    'phone',
    'mobile',
    'address',
    'postal_code',
    'city',
    'billing_address',
    'billing_postal_code',
    'billing_city',
    'billing_email',
    'invoice_reference',
    'notes',
  ])
  if (!changes.length) return null
  return { eventType: 'customer.updated', metadata: { changes } }
}

// ---- Line item (ÄTA / utgift) ----

export interface LineItemDiffRow {
  type: 'ata' | 'utgift'
  description: string
  amount: number
  date: string | null
  notes: string | null
}

export function buildLineItemUpdateEvent(
  existing: LineItemDiffRow,
  next: Partial<LineItemDiffRow>
): ActivityDescriptor | null {
  const changes = diffFields(existing, next, ['description', 'amount', 'date', 'notes'])
  if (!changes.length) return null
  const eventType = existing.type === 'ata' ? 'line_item.ata_updated' : 'line_item.expense_updated'
  return { eventType, metadata: { changes } }
}

// ---- Task ----
// Ingen generisk "task.updated" finns i event_type-taxonomin – titel-/
// anteckningsredigeringar loggas medvetet INTE (brus, ingen affärshändelse en
// PM behöver se). Status/förfallodatum är däremot egna, distinkta händelser.
// Byte av projekt (task.assigned) hanteras separat i routen (kräver namn-
// uppslag av gammalt/nytt projekt), inte här.

export interface TaskDiffRow {
  title: string
  status: string
  due_date: string | null
}

export function buildTaskUpdateEvents(
  existing: TaskDiffRow,
  next: { status?: string; due_date?: string | null }
): ActivityDescriptor[] {
  const events: ActivityDescriptor[] = []

  if (next.status !== undefined && next.status !== existing.status) {
    if (next.status === 'avslutad') {
      events.push({ eventType: 'task.completed', metadata: { title: existing.title } })
    } else if (existing.status === 'avslutad') {
      events.push({ eventType: 'task.reopened', metadata: { title: existing.title } })
    }
  }

  if (next.due_date !== undefined && next.due_date !== existing.due_date) {
    events.push({
      eventType: 'task.due_date_changed',
      metadata: { title: existing.title, old_value: existing.due_date, new_value: next.due_date },
    })
  }

  return events
}

// ---- Assignment ----

export interface AssignmentDiffRow {
  start_date: string
  end_date: string
  resource_id: number
  project_id: number
}

export function buildAssignmentRescheduleEvent(
  existing: AssignmentDiffRow,
  next: { start_date: string; end_date: string; resource_id: number; project_id: number },
  resourceName: string
): ActivityDescriptor | null {
  const changed =
    next.start_date !== existing.start_date ||
    next.end_date !== existing.end_date ||
    next.resource_id !== existing.resource_id ||
    next.project_id !== existing.project_id
  if (!changed) return null
  return {
    eventType: 'assignment.rescheduled',
    metadata: {
      resource_name: resourceName,
      old_start_date: existing.start_date,
      new_start_date: next.start_date,
      old_end_date: existing.end_date,
      new_end_date: next.end_date,
      resource_changed: next.resource_id !== existing.resource_id,
      project_changed: next.project_id !== existing.project_id,
    },
  }
}
