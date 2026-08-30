import type { Resource, Project, Assignment, Task, User, Me, Org, Department } from '../types'

/**
 * Delad datacache – motsvarar gamla appens globala `state` + `loadAll()`.
 * Vue-reaktivitet ersätter `renderAll()`: komponenter läser dessa refs via computed.
 */
export function useAppData() {
  const resources = useState<Resource[]>('resources', () => [])
  const projects = useState<Project[]>('projects', () => [])
  const assignments = useState<Assignment[]>('assignments', () => [])
  const users = useState<User[]>('users', () => [])
  const departments = useState<Department[]>('departments', () => [])
  const currentUser = useState<Me | null>('currentUser', () => null)
  const org = useState<Org | null>('org', () => null)
  const tasks = useState<Task[]>('tasks', () => [])
  const loaded = useState<boolean>('appDataLoaded', () => false)

  const { api } = useApi()

  async function loadAll() {
    const [r, p, a, u, d, me, t] = await Promise.all([
      api<Resource[]>('GET', '/api/resources'),
      api<Project[]>('GET', '/api/projects'),
      api<Assignment[]>('GET', '/api/assignments'),
      api<User[]>('GET', '/api/users'),
      api<Department[]>('GET', '/api/departments'),
      api<Me>('GET', '/api/me'),
      api<Task[]>('GET', '/api/tasks'),
    ])
    resources.value = r
    projects.value = p
    assignments.value = a
    users.value = u
    departments.value = d
    currentUser.value = me
    org.value = me.org
    tasks.value = t
    loaded.value = true
  }

  return { resources, projects, assignments, users, departments, currentUser, org, tasks, loaded, loadAll }
}
