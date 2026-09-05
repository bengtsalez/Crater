import type { Project, Resource, Assignment, Task, LineItem } from '../types'

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

  function openProjectModal(p: Project | null, opts: { onCreated?: (p: Project) => void } = {}) {
    project.value = { open: true, project: p, onCreated: opts.onCreated || null }
  }
  function openResourceModal(r: Resource | null) {
    resource.value = { open: true, resource: r }
  }
  function openAssignmentModal(
    opts: { assignment?: Assignment | null; resourceId?: number | null; date?: string | null } = {}
  ) {
    assignment.value = {
      open: true,
      assignment: opts.assignment ?? null,
      resourceId: opts.resourceId ?? null,
      date: opts.date ?? null,
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

  return {
    project,
    resource,
    assignment,
    task,
    lineItem,
    projectList,
    openProjectModal,
    openResourceModal,
    openAssignmentModal,
    openTaskModal,
    openLineItemModal,
    openProjectListModal,
  }
}
