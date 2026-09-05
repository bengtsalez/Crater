<script setup lang="ts">
const { loadAll, loaded, loadErrors } = useAppData()
const { activeTab, projectDetailId } = useUiState()
const toast = useToast()

const loadError = ref('')
const pending = ref(true)

const partialErrorText = computed(() => {
  const keys = Object.keys(loadErrors.value)
  if (!keys.length) return ''
  const labels: Record<string, string> = {
    users: 'användare',
    departments: 'avdelningar',
    tasks: 'uppgifter',
  }
  return keys.map((k) => labels[k] || k).join(', ')
})

onMounted(async () => {
  try {
    await loadAll()
  } catch (err) {
    loadError.value = (err as Error).message
    toast.add({ title: 'Kunde inte ladda data: ' + (err as Error).message, color: 'error' })
  } finally {
    pending.value = false
  }
})
</script>

<template>
  <div>
    <p v-if="loadError" class="empty-state">Kunde inte ladda data: {{ loadError }}</p>
    <p v-else-if="pending && !loaded" class="empty-state">Laddar…</p>
    <template v-else-if="loaded">
      <p v-if="partialErrorText" class="load-warning">
        Vissa uppgifter kunde inte hämtas ({{ partialErrorText }}). Övrigt fungerar.
      </p>
      <ProjectDetail v-if="projectDetailId" />
      <template v-else>
        <TheTimeline v-if="activeTab === 'timeline'" />
        <AnalyticsPanel v-else-if="activeTab === 'analytics'" />
        <MonthCalendar v-else-if="activeTab === 'month'" />
        <ProjectsPanel v-else-if="activeTab === 'projects'" />
        <ResourcesPanel v-else-if="activeTab === 'resources'" />
        <MinSidaPanel v-else-if="activeTab === 'minsida'" />
      </template>
    </template>

    <AppModals />
  </div>
</template>

<style scoped>
.load-warning {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: #fff4e5;
  color: #8a5300;
  font-size: 0.9rem;
}
</style>
