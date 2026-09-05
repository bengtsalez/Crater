import type { Resource, Project, Assignment, Task, User, Me, Org, Department } from '../types'
import type { Ref } from 'vue'

/**
 * Delad datacache – motsvarar gamla appens globala `state` + `loadAll()`.
 * Vue-reaktivitet ersätter `renderAll()`: komponenter läser dessa refs via computed.
 *
 * `loadAll()` laddar i två nivåer:
 *  - Kritiskt (projekt, bokningar, resurser, me): ett fel här kastas vidare och
 *    blockerar appen – utan dessa finns inget att visa.
 *  - Sekundärt (users, departments, tasks): ett fel loggas i `loadErrors` men
 *    stoppar inte resten. Tidigare värden behålls.
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
  const loadErrors = useState<Record<string, string>>('appDataErrors', () => ({}))

  const { api } = useApi()

  function assignSettled<T>(result: PromiseSettledResult<T>, ref: Ref<T>, key: string) {
    if (result.status === 'fulfilled') {
      ref.value = result.value
      if (loadErrors.value[key]) {
        const next = { ...loadErrors.value }
        delete next[key]
        loadErrors.value = next
      }
    } else {
      loadErrors.value = {
        ...loadErrors.value,
        [key]: (result.reason as Error)?.message || 'Kunde inte hämtas',
      }
    }
  }

  async function loadAll() {
    // Kritisk data – ett fel här är ett riktigt fel.
    const [r, p, a, me] = await Promise.all([
      api<Resource[]>('GET', '/api/resources'),
      api<Project[]>('GET', '/api/projects'),
      api<Assignment[]>('GET', '/api/assignments'),
      api<Me>('GET', '/api/me'),
    ])
    resources.value = r
    projects.value = p
    assignments.value = a
    currentUser.value = me
    org.value = me.org

    // Sekundär data – behåll tidigare värde vid fel, flagga i loadErrors.
    const [u, d, t] = await Promise.allSettled([
      api<User[]>('GET', '/api/users'),
      api<Department[]>('GET', '/api/departments'),
      api<Task[]>('GET', '/api/tasks'),
    ])
    assignSettled(u, users, 'users')
    assignSettled(d, departments, 'departments')
    assignSettled(t, tasks, 'tasks')

    loaded.value = true
  }

  return {
    resources,
    projects,
    assignments,
    users,
    departments,
    currentUser,
    org,
    tasks,
    loaded,
    loadErrors,
    loadAll,
  }
}
