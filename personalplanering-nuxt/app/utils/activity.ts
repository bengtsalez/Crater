import type { ActivityEvent } from '../types'
import { formatSum } from './format'
import { STATUS_LABELS } from './constants'

interface FieldChange {
  field: string
  old_value: unknown
  new_value: unknown
}

export interface ActivityDisplay {
  icon: string
  title: string
  secondary?: string
}

const FIELD_LABELS: Record<string, string> = {
  name: 'namn',
  start_date: 'byggstart',
  end_date: 'byggslut',
  sum: 'kontraktssumma',
  notes: 'anteckningar',
  category: 'kategori',
  billing_type: 'faktureringstyp',
  status_override: 'manuell status',
  customer_name: 'kund',
  project_manager_username: 'projektledare',
  site_address: 'arbetsplatsens adress',
  customer_type: 'kundtyp',
  organization_number: 'org.nr',
  contact_person: 'kontaktperson',
  email: 'e-post',
  phone: 'telefon',
  mobile: 'mobil',
  address: 'adress',
  postal_code: 'postnummer',
  city: 'ort',
  billing_address: 'fakturaadress',
  billing_postal_code: 'faktura-postnummer',
  billing_city: 'faktura-ort',
  billing_email: 'faktura-e-post',
  invoice_reference: 'referens',
  description: 'beskrivning',
  amount: 'belopp',
  date: 'datum',
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] || field
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '–'
  if (field === 'sum' || field === 'amount') return formatSum(value as number)
  if (field === 'status_override') return STATUS_LABELS[value as string] || String(value)
  return String(value)
}

function actorName(e: ActivityEvent): string {
  return e.actor_username || 'Crater'
}

function updatedDisplay(e: ActivityEvent, entityLabel: string): ActivityDisplay {
  const changes = (e.metadata.changes as FieldChange[]) || []
  const single = changes.length === 1 ? changes[0] : undefined
  if (single) {
    return {
      icon: 'i-lucide-pencil',
      title: `${actorName(e)} ändrade ${fieldLabel(single.field)}`,
      secondary: `${formatValue(single.field, single.old_value)} → ${formatValue(single.field, single.new_value)}`,
    }
  }
  return {
    icon: 'i-lucide-pencil',
    title: `${actorName(e)} uppdaterade ${entityLabel} (${changes.length} fält)`,
    secondary: changes.map((c) => fieldLabel(c.field)).join(', '),
  }
}

const FORMATTERS: Record<string, (e: ActivityEvent) => ActivityDisplay> = {
  'project.created': (e) => ({
    icon: 'i-lucide-folder-plus',
    title: `${actorName(e)} skapade projektet "${e.metadata.name}"`,
    secondary: e.metadata.customer_name ? `Kund: ${e.metadata.customer_name}` : undefined,
  }),
  'small_job.created': (e) => ({
    icon: 'i-lucide-folder-plus',
    title: `${actorName(e)} skapade ströjobbet "${e.metadata.name}"`,
  }),
  'project.updated': (e) => updatedDisplay(e, 'projektet'),
  'project.status_changed': (e) => ({
    icon: 'i-lucide-refresh-cw',
    title: `${actorName(e)} ändrade status till ${STATUS_LABELS[e.metadata.new_value as string] || e.metadata.new_value}`,
  }),
  'small_job.completed': () => ({ icon: 'i-lucide-check-circle', title: 'Ströjobbet markerades som slutfört' }),

  'staff_info.updated': (e) => ({
    icon: 'i-lucide-clipboard-list',
    title: `${actorName(e)} uppdaterade informationen till personal`,
  }),
  'staff_info.published': (e) => ({
    icon: 'i-lucide-eye',
    title: `${actorName(e)} gjorde informationen synlig för personal`,
  }),
  'staff_info.unpublished': (e) => ({
    icon: 'i-lucide-eye-off',
    title: `${actorName(e)} dolde informationen för personal`,
  }),

  'customer.created': (e) => ({ icon: 'i-lucide-user-plus', title: `${actorName(e)} skapade kunden "${e.metadata.name}"` }),
  'customer.updated': (e) => updatedDisplay(e, 'kunden'),

  'task.created': (e) => ({ icon: 'i-lucide-list-plus', title: `${actorName(e)} skapade uppgiften "${e.metadata.title}"` }),
  'task.completed': (e) => ({ icon: 'i-lucide-check', title: `${actorName(e)} markerade uppgiften "${e.metadata.title}" som klar` }),
  'task.reopened': (e) => ({ icon: 'i-lucide-rotate-ccw', title: `${actorName(e)} återöppnade uppgiften "${e.metadata.title}"` }),
  'task.assigned': (e) => ({
    icon: 'i-lucide-move',
    title: `${actorName(e)} flyttade uppgiften "${e.metadata.title}"`,
    secondary: `${e.metadata.from_project || 'Inget projekt'} → ${e.metadata.to_project || 'Inget projekt'}`,
  }),
  'task.due_date_changed': (e) => ({
    icon: 'i-lucide-calendar',
    title: `${actorName(e)} ändrade förfallodatum för "${e.metadata.title}"`,
    secondary: `${e.metadata.old_value || '–'} → ${e.metadata.new_value || '–'}`,
  }),
  'task.deleted': (e) => ({ icon: 'i-lucide-trash-2', title: `${actorName(e)} tog bort uppgiften "${e.metadata.title}"` }),

  'line_item.ata_created': (e) => ({
    icon: 'i-lucide-plus-circle',
    title: `${actorName(e)} skapade ÄTA "${e.metadata.description}" på ${formatSum(e.metadata.amount as number)}`,
  }),
  'line_item.ata_updated': (e) => updatedDisplay(e, 'ÄTA-raden'),
  'line_item.ata_deleted': (e) => ({ icon: 'i-lucide-trash-2', title: `${actorName(e)} tog bort ÄTA "${e.metadata.description}"` }),
  'line_item.expense_created': (e) => ({
    icon: 'i-lucide-receipt',
    title: `${actorName(e)} lade till utgiften "${e.metadata.description}" på ${formatSum(e.metadata.amount as number)}`,
  }),
  'line_item.expense_updated': (e) => updatedDisplay(e, 'utgiften'),
  'line_item.expense_deleted': (e) => ({
    icon: 'i-lucide-trash-2',
    title: `${actorName(e)} tog bort utgiften "${e.metadata.description}"`,
  }),

  'assignment.created': (e) => ({
    icon: 'i-lucide-calendar-plus',
    title: `${actorName(e)} bokade in ${e.metadata.resource_name}`,
    secondary: `${e.metadata.start_date} – ${e.metadata.end_date}`,
  }),
  'assignment.rescheduled': (e) => ({
    icon: 'i-lucide-calendar-clock',
    title: `${actorName(e)} ändrade byggstart för ${e.metadata.resource_name}`,
    secondary: `${e.metadata.old_start_date} → ${e.metadata.new_start_date}`,
  }),
  'assignment.deleted': (e) => ({
    icon: 'i-lucide-calendar-x',
    title: `${actorName(e)} tog bort bokningen för ${e.metadata.resource_name}`,
  }),
}

export function formatActivity(e: ActivityEvent): ActivityDisplay {
  return FORMATTERS[e.event_type]?.(e) ?? { icon: 'i-lucide-activity', title: e.event_type }
}
