export type UserRole = 'admin' | 'member'

export interface User {
  id: number
  username: string
  email?: string | null
  role?: UserRole
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

export interface Project {
  id: number
  project_number: string
  name: string
  client: string | null
  project_manager_user_id: number | null
  project_manager_username: string | null
  sum: number | null
  start_date: string | null
  end_date: string | null
  status: string
  notes: string | null
  category: string | null
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
