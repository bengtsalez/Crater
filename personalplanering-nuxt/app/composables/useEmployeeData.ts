import type { EmployeeJob } from '../types'

// Personalvyns egen, begränsade datacache. Anropar BARA /api/employee/** –
// aldrig useAppData().loadAll() (som hämtar hela org:ens interna data).
// Egen pollingtimer med samma mönster som useAppData: en global timer,
// pausar när fliken är dold och laddar direkt när man kommer tillbaka.
const POLL_INTERVAL_MS = 20000
let pollTimer: ReturnType<typeof setInterval> | null = null
let visibilityHandler: (() => void) | null = null
let pollFn: (() => Promise<unknown>) | null = null

export function useEmployeeData() {
  const jobs = useState<EmployeeJob[]>('emp:jobs', () => [])
  const today = useState<string>('emp:today', () => '')
  const loaded = useState<boolean>('emp:loaded', () => false)
  const { api } = useApi()

  async function loadJobs(range?: { from: string; to: string } | null) {
    const qs = range ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : ''
    const res = await api<{ today: string; jobs: EmployeeJob[] }>('GET', `/api/employee/jobs${qs}`)
    jobs.value = res.jobs
    today.value = res.today
    loaded.value = true
    return res
  }

  // `fn` = vad som ska laddas om (listan eller en detaljvy).
  function startPolling(fn: () => Promise<unknown>) {
    if (!import.meta.client) return
    pollFn = fn
    if (pollTimer) return
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') pollFn?.().catch(() => {})
    }
    document.addEventListener('visibilitychange', visibilityHandler)
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') pollFn?.().catch(() => {})
    }, POLL_INTERVAL_MS)
  }

  // Med `fn`: stoppa bara om det fortfarande är den som pollas (vid sidbyte kan
  // nästa sida hinna starta sin polling innan föregående avmonteras).
  function stopPolling(fn?: () => Promise<unknown>) {
    if (fn && pollFn !== fn) return
    pollFn = null
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
  }

  return { jobs, today, loaded, loadJobs, startPolling, stopPolling }
}
