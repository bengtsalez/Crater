import type { ActivityEvent } from '../types'

export function useProjectActivity() {
  const activities = useState<ActivityEvent[]>('pd:activities', () => [])
  const { api } = useApi()
  const { projectDetailId } = useUiState()

  async function refresh() {
    const id = projectDetailId.value
    if (!id) return
    activities.value = await api<ActivityEvent[]>('GET', `/api/projects/${id}/activities`)
  }

  return { activities, refresh }
}
