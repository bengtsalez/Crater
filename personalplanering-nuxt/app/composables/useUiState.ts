export type TabName = 'timeline' | 'analytics' | 'month' | 'projects' | 'resources' | 'minsida'

/**
 * UI-tillstånd som behöver delas mellan flikar (t.ex. tidslinjens badge som filtrerar
 * "Min sida", och projektdetalj-vyn som öppnas från projektlistan).
 */
export function useUiState() {
  const activeTab = useState<TabName>('ui:activeTab', () => 'timeline')
  const projectDetailId = useState<number | null>('ui:projectDetailId', () => null)
  const myTasksProjectFilter = useState<number | null>('ui:myTasksProjectFilter', () => null)

  function goToMyTasksForProject(projectId: number) {
    myTasksProjectFilter.value = projectId
    projectDetailId.value = null
    activeTab.value = 'minsida'
  }

  function openProjectDetail(projectId: number) {
    projectDetailId.value = projectId
  }

  function closeProjectDetail() {
    projectDetailId.value = null
    activeTab.value = 'projects'
  }

  return {
    activeTab,
    projectDetailId,
    myTasksProjectFilter,
    goToMyTasksForProject,
    openProjectDetail,
    closeProjectDetail,
  }
}
