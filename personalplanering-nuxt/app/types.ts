export type UserRole = 'admin' | 'member' | 'employee' | 'accountant'

export interface User {
  id: number
  username: string
  email?: string | null
  role?: UserRole
  active?: boolean
  phone?: string | null
  resource_id?: number | null
  resource_name?: string | null
}

export interface Org {
  id: number
  name: string
  app_title: string | null
  onboarded_at: string | null
  onboarding_state?: OnboardingState
}

export interface OnboardingState {
  step?: number
  completed?: number[]
  skipped?: number[]
}

export interface Me {
  id: number
  username: string
  role: UserRole
  /** Kopplad personalresurs – bara för personalkonton. */
  resource: { id: number; name: string } | null
  org: Org | null
}

export interface Department {
  id: number
  org_id: number
  key: string
  label: string
  sort_order: number
}

export interface Resource {
  id: number
  name: string
  type: 'anstalld' | 'underentreprenor'
  category: string | null
  phone: string | null
  active: number
  color: string | null
}

export interface Customer {
  id: number
  org_id: number
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
  created_at: string
  updated_at: string
  project_count: number
  last_project_number: string | null
  last_project_name: string | null
  last_project_date: string | null
}

export interface Project {
  id: number
  project_number: string
  name: string
  /** @deprecated Legacy spegel av customer_name, skriven av servern. Läs customer_name i stället. */
  client: string | null
  customer_id: number | null
  customer_name: string | null
  project_manager_user_id: number | null
  project_manager_username: string | null
  sum: number | null
  start_date: string | null
  end_date: string | null
  status: string
  status_override: string | null
  notes: string | null
  category: string | null
  work_type: 'project' | 'small_job'
  billing_type: 'billable' | 'warranty' | 'internal'
  source_project_id: number | null
  site_address?: string | null
}

export interface Assignment {
  id: number
  resource_id: number
  project_id: number
  start_date: string
  end_date: string
  note: string | null
  resource_name: string
  resource_type: 'anstalld' | 'underentreprenor'
  project_number: string
  project_name: string
}

export interface Task {
  id: number
  user_id: number
  project_id: number | null
  title: string
  notes: string | null
  status: string
  due_date: string | null
  created_at: string
  completed_at: string | null
  project_number: string | null
  project_name: string | null
  username?: string
  user_role?: UserRole
}

export interface LineItem {
  id: number
  project_id: number
  type: 'ata' | 'utgift'
  description: string
  amount: number
  date: string | null
  notes: string | null
  created_at: string
}

export interface ActivityEvent {
  id: number
  user_id: number | null
  actor_username: string | null
  entity_type: string
  entity_id: number
  project_id: number | null
  customer_id: number | null
  event_type: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface StaffInfo {
  instructions: string | null
  published: boolean
  updated_at: string | null
  updated_by_username: string | null
}

// ---- Personalvyn (/personal) – svar från /api/employee/** ----

export interface EmployeeJob {
  assignment_id: number
  start_date: string
  end_date: string
  note: string | null
  project_id: number
  project_number: string
  project_name: string
  site_address: string | null
  work_type: 'project' | 'small_job'
  remaining_tasks: number
}

export interface EmployeeTask {
  id: number
  title: string
  notes: string | null
  status: string
  due_date: string | null
  completed_at: string | null
}

export interface EmployeeJobDetail {
  project: { id: number; project_number: string; name: string; site_address: string | null; work_type: string }
  my_bookings: { id: number; start_date: string; end_date: string; note: string | null }[]
  project_manager: { username: string; phone: string | null; email: string | null } | null
  customer: {
    name: string | null
    contact_person: string | null
    phone: string | null
    mobile: string | null
    address: string | null
    postal_code: string | null
    city: string | null
  } | null
  staff_info: { instructions: string; updated_at: string; updated_by: string | null } | null
  tasks: EmployeeTask[]
}

// ---- Redovisningsvyn (rollen 'accountant') ----

export interface AccountantCustomer {
  name: string | null
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
}

export interface AccountantProject {
  id: number
  project_number: string
  name: string
  status: string
  work_type: 'project' | 'small_job'
  billing_type: 'billable' | 'warranty' | 'internal'
  sum: number | null
  start_date: string | null
  end_date: string | null
  site_address: string | null
  project_manager_username: string | null
  customer_id: number | null
  customer_name: string | null
  customer_organization_number: string | null
  customer_city: string | null
  ata_total: number
  expense_total: number
}

export interface AccountantLineItem {
  id: number
  type: 'ata' | 'utgift'
  description: string
  amount: number
  date: string | null
}

export interface AccountantProjectDetail {
  project: Omit<AccountantProject, 'customer_name' | 'customer_organization_number' | 'customer_city' | 'ata_total' | 'expense_total'>
  customer: AccountantCustomer | null
  line_items: AccountantLineItem[]
}
