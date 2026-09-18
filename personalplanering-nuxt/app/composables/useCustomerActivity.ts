import type { ActivityEvent } from '../types'

export function useCustomerActivity() {
  const activities = useState<ActivityEvent[]>('cd:activities', () => [])
  const { api } = useApi()
  const { customerDetailId } = useUiState()

  async function refresh() {
    const id = customerDetailId.value
    if (!id) return
    activities.value = await api<ActivityEvent[]>('GET', `/api/customers/${id}/activities`)
  }

  return { activities, refresh }
}
