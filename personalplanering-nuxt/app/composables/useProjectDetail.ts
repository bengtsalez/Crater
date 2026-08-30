import type { Task, LineItem } from '../types'

export function useProjectDetail() {
  const lineItems = useState<LineItem[]>('pd:lineItems', () => [])
  const tasks = useState<Task[]>('pd:tasks', () => [])
  const { api } = useApi()
  const { projectDetailId } = useUiState()

  async function refresh() {
    const id = projectDetailId.value
    if (!id) return
    const [li, t] = await Promise.all([
      api<LineItem[]>('GET', `/api/projects/${id}/line-items`),
      api<Task[]>('GET', `/api/projects/${id}/tasks`),
    ])
    lineItems.value = li
    tasks.value = t
  }

  return { lineItems, tasks, refresh }
}
