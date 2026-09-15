import type { Project, Resource, Assignment, Task, LineItem, Customer } from '../types'

interface ProjectModalState {
  open: boolean
  project: Project | null
  onCreated: ((p: Project) => void) | null
}
interface ResourceModalState {
  open: boolean
  resource: Resource | null
}
interface AssignmentModalState {
  open: boolean
  assignment: Assignment | null
  resourceId: number | null
  date: string | null
  projectId: number | null
}
interface TaskModalState {
  open: boolean
  task: Task | null
  defaultProjectId: number | null
}
interface LineItemModalState {
  open: boolean
  type: 'ata' | 'utgift'
  item: LineItem | null
  projectId: number | null
}
interface ProjectListModalState {
  open: boolean
  title: string
  projects: Project[]
  showSum: boolean
}
interface QuickJobModalState {
  open: boolean
  onCreated: ((p: Project) => void) | null
  resourceId: number | null
  date: string | null
}
interface CustomerModalState {
  open: boolean
  customer: Customer | null
}

export function useModals() {
  const project = useState<ProjectModalState>('modal:project', () => ({
    open: false,
    project: null,
    onCreated: null,
  }))
  const resource = useState<ResourceModalState>('modal:resource', () => ({ open: false, resource: null }))
  const assignment = useState<AssignmentModalState>('modal:assignment', () => ({
    open: false,
    assignment: null,
    resourceId: null,
    date: null,
    projectId: null,
  }))
  const task = useState<TaskModalState>('modal:task', () => ({
    open: false,
    task: null,
    defaultProjectId: null,
  }))
  const lineItem = useState<LineItemModalState>('modal:lineItem', () => ({
    open: false,
    type: 'ata',
    item: null,
    projectId: null,
  }))
  const projectList = useState<ProjectListModalState>('modal:projectList', () => ({
    open: false,
    title: '',
    projects: [],
    showSum: false,
  }))
  const quickJob = useState<QuickJobModalState>('modal:quickJob', () => ({
    open: false,
    onCreated: null,
    resourceId: null,
    date: null,
  }))
  const customer = useState<CustomerModalState>('modal:customer', () => ({ open: false, customer: null }))

  function openProjectModal(p: Project | null, opts: { onCreated?: (p: Project) => void } = {}) {
    project.value = { open: true, project: p, onCreated: opts.onCreated || null }
  }
  function openResourceModal(r: Resource | null) {
    resource.value = { open: true, resource: r }
  }
  function openAssignmentModal(
    opts: {
      assignment?: Assignment | null
      resourceId?: number | null
      date?: string | null
      projectId?: number | null
    } = {}
  ) {
    assignment.value = {
      open: true,
      assignment: opts.assignment ?? null,
      resourceId: opts.resourceId ?? null,
      date: opts.date ?? null,
      projectId: opts.projectId ?? null,
    }
  }
  function openTaskModal(t: Task | null, defaultProjectId: number | null = null) {
    task.value = { open: true, task: t, defaultProjectId }
  }
  function openLineItemModal(type: 'ata' | 'utgift', item: LineItem | null, projectId: number | null) {
    lineItem.value = { open: true, type, item, projectId }
  }
  function openProjectListModal(opts: { title: string; projects: Project[]; showSum?: boolean }) {
    projectList.value = {
      open: true,
      title: opts.title,
      projects: opts.projects,
      showSum: opts.showSum ?? false,
    }
  }
  function openQuickJobModal(
    opts: { onCreated?: (p: Project) => void; resourceId?: number | null; date?: string | null } = {}
  ) {
    quickJob.value = {
      open: true,
      onCreated: opts.onCreated || null,
      resourceId: opts.resourceId ?? null,
      date: opts.date ?? null,
    }
  }
  function openCustomerModal(c: Customer | null) {
    customer.value = { open: true, customer: c }
  }

  return {
    project,
    resource,
    assignment,
    task,
    lineItem,
    projectList,
    quickJob,
    customer,
    openProjectModal,
    openResourceModal,
    openAssignmentModal,
    openTaskModal,
    openLineItemModal,
    openProjectListModal,
    openQuickJobModal,
    openCustomerModal,
  }
}
