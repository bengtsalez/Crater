<script setup lang="ts">
const { loadAll, loaded } = useAppData()
const { activeTab, projectDetailId } = useUiState()
const toast = useToast()

const loadError = ref('')
const pending = ref(true)

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
