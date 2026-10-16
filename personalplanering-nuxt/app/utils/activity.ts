import type { ActivityEvent } from '../types'
import { formatSum } from './format'
import { STATUS_LABELS } from './constants'
import { ATA_STATUS_LABELS, formatOre, PART_STATUS_LABELS, ROT_STATUS_LABELS } from '../../shared/billing'

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
  base_total_inc_ore: 'grundavtalets totalsumma',
  rot_enabled: 'ROT aktiverat',
  rot_rate_bp: 'ROT-procentsats',
  property_designation: 'fastighetsbeteckning',
  housing_type: 'bostadstyp',
  brf_name: 'bostadsrättsförening',
  brf_org_number: 'föreningens org.nr',
  apartment_number: 'lägenhetsnummer',
  location: 'plats/etapp',
  responsible: 'ansvarig',
  due_date: 'sista datum',
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] || field
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '–'
  if (field === 'sum' || field === 'amount') return formatSum(value as number)
  if (field === 'status_override') return STATUS_LABELS[value as string] || String(value)
  if (field === 'base_total_inc_ore') return formatOre(value as number)
  if (field === 'rot_rate_bp') return `${(value as number) / 100} %`
  if (field === 'rot_enabled') return value ? 'ja' : 'nej'
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

const inspLabel = (e: ActivityEvent) => `${e.metadata.name}${e.metadata.location ? ` – ${e.metadata.location}` : ''}`
const devLabel = (e: ActivityEvent) => `${e.metadata.inspection}${e.metadata.location ? ` – ${e.metadata.location}` : ''}`

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

  'line_item.ata_status_changed': (e) => ({
    icon: 'i-lucide-badge-check',
    title: `${actorName(e)} ändrade status för ÄTA "${e.metadata.description}"`,
    secondary: `${ATA_STATUS_LABELS[e.metadata.from as keyof typeof ATA_STATUS_LABELS] ?? e.metadata.from} → ${ATA_STATUS_LABELS[e.metadata.to as keyof typeof ATA_STATUS_LABELS] ?? e.metadata.to}`,
  }),

  'billing.settings_updated': (e) => updatedDisplay(e, 'faktureringens grundavtal'),
  'billing.lines_updated': (e) => ({
    icon: 'i-lucide-receipt-text',
    title: `${actorName(e)} uppdaterade grundunderlagets fakturarader`,
    secondary: `${e.metadata.count} rader`,
  }),
  'billing.plan_updated': (e) => ({
    icon: 'i-lucide-list-ordered',
    title: `${actorName(e)} uppdaterade betalningsplanen`,
    secondary: `${e.metadata.installments} delbetalningar`,
  }),
  'billing.allocation_updated': (e) => ({ icon: 'i-lucide-split', title: `${actorName(e)} justerade fördelningen mellan delbetalningar` }),
  'billing.allocation_reset': (e) => ({ icon: 'i-lucide-split', title: `${actorName(e)} återställde proportionell fördelning` }),
  'billing.ata_imported': (e) => ({
    icon: 'i-lucide-file-plus',
    title: `${actorName(e)} hämtade ÄTA "${e.metadata.description}" till fakturering`,
    secondary: e.metadata.document_number as string,
  }),
  'billing.ata_change_acknowledged': (e) => ({ icon: 'i-lucide-check-check', title: `${actorName(e)} bekräftade ändrad ÄTA i faktureringsunderlag` }),
  'billing.part_updated': (e) => ({
    icon: 'i-lucide-pencil',
    title: `${actorName(e)} ändrade faktureringsdelen "${e.metadata.name}"`,
    secondary: e.metadata.document_number as string,
  }),
  'billing.part_deleted': (e) => ({ icon: 'i-lucide-trash-2', title: `${actorName(e)} tog bort faktureringsdelen "${e.metadata.name}"` }),
  'billing.part_status_changed': (e) => ({
    icon: e.metadata.to === 'fakturerad' ? 'i-lucide-lock' : 'i-lucide-refresh-cw',
    title: `${actorName(e)} ändrade status för ${e.metadata.document_number} "${e.metadata.name}"`,
    secondary: `${PART_STATUS_LABELS[e.metadata.from as keyof typeof PART_STATUS_LABELS] ?? e.metadata.from} → ${PART_STATUS_LABELS[e.metadata.to as keyof typeof PART_STATUS_LABELS] ?? e.metadata.to}`,
  }),
  'billing.payment_recorded': (e) => ({
    icon: 'i-lucide-banknote',
    title: `${actorName(e)} registrerade kundbetalning för ${e.metadata.document_number}`,
    secondary: `${formatOre(e.metadata.old_ore as number)} → ${formatOre(e.metadata.new_ore as number)}`,
  }),
  'billing.rot_status_changed': (e) => ({
    icon: 'i-lucide-landmark',
    title: `${actorName(e)} uppdaterade ROT för ${e.metadata.document_number}`,
    secondary: `${ROT_STATUS_LABELS[e.metadata.to as keyof typeof ROT_STATUS_LABELS] ?? e.metadata.to} · sökt ${formatOre(e.metadata.applied_ore as number)} · utbetalt ${formatOre(e.metadata.paid_ore as number)}`,
  }),
  'billing.correction_created': (e) => ({
    icon: 'i-lucide-file-diff',
    title: `${actorName(e)} skapade korrigering ${e.metadata.document_number}`,
    secondary: `Korrigerar ${e.metadata.corrects}`,
  }),

  // ---- Egenkontroller & checklistor ----
  'inspection.created': (e) => ({
    icon: 'i-lucide-clipboard-plus',
    title: `${actorName(e)} lade till kontrollen "${inspLabel(e)}"`,
    secondary: e.metadata.responsible ? `Ansvarig: ${e.metadata.responsible}` : undefined,
  }),
  'inspection.updated': (e) => updatedDisplay(e, `kontrollen "${inspLabel(e)}"`),
  'inspection.customized': (e) => ({ icon: 'i-lucide-list-checks', title: `${actorName(e)} anpassade punkterna i "${inspLabel(e)}"` }),
  'inspection.submitted': (e) => ({ icon: 'i-lucide-send', title: `${actorName(e)} lämnade in "${inspLabel(e)}" för granskning` }),
  'inspection.changes_requested': (e) => ({
    icon: 'i-lucide-message-square-warning',
    title: `${actorName(e)} begärde komplettering av "${inspLabel(e)}"`,
    secondary: (e.metadata.comment as string) || undefined,
  }),
  'inspection.approved': (e) => ({
    icon: 'i-lucide-badge-check',
    title: `${actorName(e)} godkände "${inspLabel(e)}"`,
    secondary: (e.metadata.comment as string) || undefined,
  }),
  'inspection.revised': (e) => ({
    icon: 'i-lucide-git-branch',
    title: `${actorName(e)} skapade revision ${e.metadata.revision} av "${inspLabel(e)}"`,
    secondary: (e.metadata.reason as string) || undefined,
  }),
  'inspection.archived': (e) => ({ icon: 'i-lucide-archive', title: `${actorName(e)} arkiverade "${inspLabel(e)}"` }),
  'deviation.reported': (e) => ({
    icon: 'i-lucide-triangle-alert',
    title: `${actorName(e)} rapporterade avvikelse i "${devLabel(e)}"`,
    secondary: `${e.metadata.item}: ${e.metadata.description}`,
  }),
  'deviation.resolved': (e) => ({
    icon: 'i-lucide-wrench',
    title: `${actorName(e)} åtgärdade avvikelse i "${devLabel(e)}"`,
    secondary: `${e.metadata.item}: ${e.metadata.action_description}`,
  }),
  'deviation.verified': (e) => ({ icon: 'i-lucide-shield-check', title: `${actorName(e)} verifierade åtgärd i "${devLabel(e)}"`, secondary: e.metadata.item as string }),
  'deviation.reopened': (e) => ({
    icon: 'i-lucide-rotate-ccw',
    title: `${actorName(e)} återöppnade avvikelse i "${devLabel(e)}"`,
    secondary: `${e.metadata.item}: ${e.metadata.reason}`,
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
