// Typer för faktureringsvyn – delas av server (server/utils/billing.ts) och klient.
import type {
  AllocationInput,
  AtaStatus,
  BillingResult,
  CalcLine,
  LineType,
  LockedSummary,
  PartKind,
  PartStatus,
  RotStatus,
} from './billing'

export interface BillingSettings {
  base_total_inc_ore: number | null
  rot_enabled: boolean
  rot_rate_bp: number
  property_designation: string | null
  housing_type: 'villa' | 'brf' | null
  brf_name: string | null
  brf_org_number: string | null
  apartment_number: string | null
}

export interface BillingLine extends CalcLine {
  id: number
  part_id: number | null
  sort_order: number
  description: string
  unit: string | null
}

export interface RotRecipientView {
  position: number
  name: string | null
  personnummer_masked: string
  has_pnr: boolean
  amount_ore: number
}

export interface AtaInfo {
  line_item_id: number
  source: { description: string; amount: number; date: string | null } | null
  source_revision: number | null
  current: { description: string; amount: number; date: string | null; ata_status: AtaStatus; revision: number } | null
  deviation: boolean
}

export interface BillingPart {
  id: number
  kind: PartKind
  name: string
  sort_order: number
  percent_bp: number | null
  planned_date: string | null
  milestone: string | null
  notes: string | null
  document_number: string
  rot_rate_bp: number
  status: PartStatus
  locked: boolean
  locked_at: string | null
  invoiced_date: string | null
  external_invoice_ref: string | null
  customer_paid_ore: number
  customer_paid_date: string | null
  rot_status: RotStatus
  rot_applied_ore: number
  rot_paid_ore: number
  rot_applied_date: string | null
  rot_paid_date: string | null
  corrects_part_id: number | null
  corrects_document_number: string | null
  lines: BillingLine[]
  rot_recipients: RotRecipientView[]
  ata: AtaInfo | null
  documents: { id: number; version: number; created_at: string }[]
}

export interface AtaCandidate {
  id: number
  description: string
  amount: number
  date: string | null
  ata_status: AtaStatus
  part_id: number | null
  part_status: PartStatus | null
  document_number: string | null
}

export interface ProjectBillingView {
  project: { id: number; project_number: string; name: string; site_address: string | null; customer_id: number | null; contract_sum: number | null }
  settings: BillingSettings
  base_lines: BillingLine[]
  parts: BillingPart[]
  allocations: AllocationInput[]
  calc: BillingResult
}

export interface SnapshotLine {
  description: string
  line_type: LineType
  quantity: string
  unit: string | null
  unit_price_ex_vat: string
  vat_rate_bp: number
  ex_ore: number
  rot_eligible: boolean
}

export interface BillingSnapshot {
  format: 1
  draft: boolean
  version: number | null
  document_number: string
  document_date: string
  company: Record<string, string | boolean | null>
  customer: Record<string, string | null> | null
  project: { project_number: string; name: string; site_address: string | null }
  property: { property_designation: string | null; housing_type: string | null; brf_name: string | null; brf_org_number: string | null; apartment_number: string | null }
  part: {
    kind: PartKind
    name: string
    percent_bp: number | null
    planned_date: string | null
    milestone: string | null
    ata_reference: { description: string; amount: number; date: string | null } | null
    corrects_document_number: string | null
  }
  lines: SnapshotLine[]
  summary: LockedSummary
  rot: { enabled: boolean; rate_bp: number; recipients: { name: string | null; personnummer_enc: string | null; amount_ore: number }[] }
  invoiced_date: string | null
  external_invoice_ref: string | null
}

