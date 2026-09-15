import type { Resource, Project, Assignment, Task, User, Me, Org, Department, Customer } from '../types'
import type { Ref } from 'vue'

// Polling-läge – flera användare delar samma data (bokningar, uppgifter m.m.).
// En enda global timer/listener oavsett hur många komponenter som anropar
// useAppData(); start/stopPolling() är idempotenta.
const POLL_INTERVAL_MS = 20000
let pollTimer: ReturnType<typeof setInterval> | null = null
let visibilityHandler: (() => void) | null = null

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
  const customers = useState<Customer[]>('customers', () => [])
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
    const [u, d, t, cu] = await Promise.allSettled([
      api<User[]>('GET', '/api/users'),
      api<Department[]>('GET', '/api/departments'),
      api<Task[]>('GET', '/api/tasks'),
      api<Customer[]>('GET', '/api/customers'),
    ])
    assignSettled(u, users, 'users')
    assignSettled(d, departments, 'departments')
    assignSettled(t, tasks, 'tasks')
    assignSettled(cu, customers, 'customers')

    loaded.value = true
  }

  // Andra användare kan ändra bokningar/uppgifter/projekt samtidigt – poll:a
  // i bakgrunden så det syns utan att man behöver ladda om sidan. Pausar när
  // fliken inte är synlig, och laddar direkt när man kommer tillbaka till den.
  function startPolling() {
    if (!import.meta.client || pollTimer) return
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') loadAll().catch(() => {})
    }
    document.addEventListener('visibilitychange', visibilityHandler)
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') loadAll().catch(() => {})
    }, POLL_INTERVAL_MS)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
  }

  return {
    resources,
    projects,
    assignments,
    users,
    departments,
    customers,
    currentUser,
    org,
    tasks,
    loaded,
    loadErrors,
    loadAll,
    startPolling,
    stopPolling,
  }
}
