export type TabName = 'timeline' | 'analytics' | 'month' | 'projects' | 'strojobb' | 'resources' | 'kunder' | 'minsida'

/**
 * UI-tillstånd som behöver delas mellan flikar (t.ex. tidslinjens badge som filtrerar
 * "Min sida", och projektdetalj-/kunddetalj-vyerna som öppnas från listorna eller
 * från varandra). projectDetailId och customerDetailId är ömsesidigt uteslutande –
 * varje "open"-funktion nollställer den andra.
 */
export function useUiState() {
  const activeTab = useState<TabName>('ui:activeTab', () => 'timeline')
  const projectDetailId = useState<number | null>('ui:projectDetailId', () => null)
  const projectDetailReturnTab = useState<TabName>('ui:projectDetailReturnTab', () => 'projects')
  const customerDetailId = useState<number | null>('ui:customerDetailId', () => null)
  const customerDetailReturnTab = useState<TabName>('ui:customerDetailReturnTab', () => 'kunder')
  // Minnen för kryssnavigering: öppnades projektet/kunden från den andra
  // detaljvyn, ska "Tillbaka" landa där igen – inte bara på en flik.
  const projectDetailReturnCustomerId = useState<number | null>('ui:projectDetailReturnCustomerId', () => null)
  const customerDetailReturnProjectId = useState<number | null>('ui:customerDetailReturnProjectId', () => null)
  const myTasksProjectFilter = useState<number | null>('ui:myTasksProjectFilter', () => null)

  const projectDetailBackLabel = computed(() =>
    projectDetailReturnCustomerId.value ? '‹ Tillbaka till kund' : '‹ Tillbaka till projekt'
  )
  const customerDetailBackLabel = computed(() =>
    customerDetailReturnProjectId.value ? '‹ Tillbaka till projekt' : '‹ Tillbaka till kunder'
  )

  function goToMyTasksForProject(projectId: number) {
    myTasksProjectFilter.value = projectId
    projectDetailId.value = null
    customerDetailId.value = null
    activeTab.value = 'minsida'
  }

  function openProjectDetail(projectId: number) {
    // Kom ihåg varifrån detaljvyn öppnades (t.ex. Ströjobb-fliken eller kundkortet,
    // inte bara Projekt) så att "Tillbaka" landar rätt.
    projectDetailReturnCustomerId.value = customerDetailId.value
    projectDetailReturnTab.value = activeTab.value
    customerDetailId.value = null
    projectDetailId.value = projectId
  }

  function closeProjectDetail() {
    projectDetailId.value = null
    if (projectDetailReturnCustomerId.value) {
      customerDetailId.value = projectDetailReturnCustomerId.value
      projectDetailReturnCustomerId.value = null
    } else {
      activeTab.value = projectDetailReturnTab.value
    }
  }

  function openCustomerDetail(customerId: number) {
    customerDetailReturnProjectId.value = projectDetailId.value
    customerDetailReturnTab.value = activeTab.value
    projectDetailId.value = null
    customerDetailId.value = customerId
  }

  function closeCustomerDetail() {
    customerDetailId.value = null
    if (customerDetailReturnProjectId.value) {
      projectDetailId.value = customerDetailReturnProjectId.value
      customerDetailReturnProjectId.value = null
    } else {
      activeTab.value = customerDetailReturnTab.value
    }
  }

  return {
    activeTab,
    projectDetailId,
    customerDetailId,
    projectDetailBackLabel,
    customerDetailBackLabel,
    myTasksProjectFilter,
    goToMyTasksForProject,
    openProjectDetail,
    closeProjectDetail,
    openCustomerDetail,
    closeCustomerDetail,
  }
}
