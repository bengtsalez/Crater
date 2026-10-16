// Vy-typer för Egenkontroller (API-svar). Delas av klient och server.
import type {
  AnswerType,
  AnswerValue,
  Coverage,
  DeviationStatus,
  InspectionKind,
  InspectionStatus,
  ItemEvaluation,
  ProjectInspectionSummary,
  TemplateContent,
} from './inspections'

export interface InspectionTemplateSummary {
  id: number
  name: string
  kind: InspectionKind
  description: string | null
  department: string | null
  status: 'active' | 'archived'
  latest_version: number
  has_draft: boolean
  is_example: boolean
  item_count: number
  updated_at: string
}

export interface InspectionTemplateDetail extends InspectionTemplateSummary {
  draft: TemplateContent | null
  draft_rev: number
  published: TemplateContent | null
  versions: { version: number; published_at: string; published_by_name: string | null }[]
}

export interface AttachmentView {
  id: string
  content_type: string
  width: number | null
  height: number | null
  uploaded_by_name: string | null
  created_at: string
}

export interface StoredAnswer extends AnswerValue {
  answered_by_name: string | null
  answered_at: string
  rev: number
}

export interface DeviationView {
  id: number
  inspection_id: number
  item_id: number
  item_title: string
  project_id: number
  description: string
  responsible_user_id: number | null
  responsible_name: string | null
  due_date: string | null
  action_description: string | null
  status: DeviationStatus
  reported_by_name: string | null
  created_at: string
  resolved_by_name: string | null
  resolved_at: string | null
  verified_by_name: string | null
  verified_at: string | null
  reopen_reason: string | null
  task_id: number | null
  rev: number
  photos: AttachmentView[]
}

export interface DeviationListRow extends DeviationView {
  project_number: string
  project_name: string
  inspection_name: string
  inspection_location: string | null
  inspection_status: InspectionStatus
}

export interface InspectionItemView {
  id: number
  item_key: string
  section_title: string
  sort_order: number
  title: string
  instruction: string | null
  basis: string | null
  basis_url: string | null
  method: string | null
  answer_type: AnswerType
  unit: string | null
  required: boolean
  min_photos: number
  comment_required: boolean
  critical: boolean
  timing_note: string | null
  answer: StoredAnswer | null
  /** Aktuell svarsrevision (0 = inget svar sparat). Skickas med vid sparning. */
  rev: number
  photos: AttachmentView[]
  evaluation: ItemEvaluation
}

export interface InspectionEventView {
  id: number
  event_type: string
  from_status: string | null
  to_status: string | null
  comment: string | null
  user_name: string | null
  created_at: string
}

export interface InspectionPermissions {
  answer: boolean
  submit: boolean
  review: boolean
  manage: boolean
  edit_items: boolean
  revise: boolean
}

export interface InspectionView {
  id: number
  project: {
    id: number
    project_number: string
    name: string
    site_address: string | null
    customer_name: string | null
    work_type: string
  }
  name: string
  kind: InspectionKind
  description: string | null
  location: string | null
  due_date: string | null
  responsible_user_id: number | null
  responsible_name: string | null
  status: InspectionStatus
  revision: number
  previous_inspection_id: number | null
  superseded_by_id: number | null
  revision_reason: string | null
  lock_version: number
  template_id: number | null
  template_version: number
  started_at: string | null
  submitted_at: string | null
  submitted_by_name: string | null
  review_comment: string | null
  approved_at: string | null
  approved_by_name: string | null
  approval_comment: string | null
  items: InspectionItemView[]
  deviations: DeviationView[]
  coverage: Coverage
  open_deviations: number
  events: InspectionEventView[]
  revisions: { id: number; revision: number; status: InspectionStatus; approved_at: string | null }[]
  storage_configured: boolean
  can: InspectionPermissions
}

export interface InspectionListRow {
  id: number
  project_id: number
  project_number: string
  project_name: string
  work_type: string
  name: string
  kind: InspectionKind
  location: string | null
  due_date: string | null
  responsible_user_id: number | null
  responsible_name: string | null
  status: InspectionStatus
  revision: number
  template_version: number
  coverage: Coverage
  open_deviations: number
  updated_at: string
}

export interface ProjectInspectionsView {
  inspections: InspectionListRow[]
  summary: ProjectInspectionSummary
}

// ---- Ögonblicksbild (låst vid godkännande, underlag för PDF) ----

export interface SnapshotPhoto {
  id: string
  storage_key: string
  content_type: string
  width: number | null
  height: number | null
  exif_orientation: number | null
}

export interface SnapshotItem extends Omit<InspectionItemView, 'photos' | 'rev'> {
  photos: SnapshotPhoto[]
}

export interface SnapshotDeviation extends Omit<DeviationView, 'photos'> {
  photos: SnapshotPhoto[]
}

export interface InspectionSnapshot {
  schema: 1
  org: { name: string }
  project: InspectionView['project']
  inspection: Omit<
    InspectionView,
    'project' | 'items' | 'deviations' | 'events' | 'revisions' | 'storage_configured' | 'can' | 'coverage' | 'open_deviations'
  > & { template_name: string | null }
  items: SnapshotItem[]
  deviations: SnapshotDeviation[]
  events: InspectionEventView[]
  coverage: Coverage
  generated_at: string
}
