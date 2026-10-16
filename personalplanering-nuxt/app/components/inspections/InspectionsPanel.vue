<script setup lang="ts">
import { INSPECTION_STATUS_LABELS, INSPECTION_STATUSES } from '../../../shared/inspections'
import type { InspectionListRow } from '../../../shared/inspectionTypes'

// Fliken Egenkontroller: alla projektkontroller, samlad avvikelselista och
// företagets mallbibliotek (admin redigerar, projektledare läser).
const view = useState<'inspections' | 'deviations' | 'templates'>('ik:view', () => 'inspections')
const openId = useState<number | null>('ik:openId', () => null)
const { api } = useApi()
const { users } = useAppData()

const rows = ref<InspectionListRow[]>([])
const loadError = ref('')
const loading = ref(false)
const filter = reactive({ status: '', responsible_user_id: '', search: '' })

async function load() {
  loading.value = true
  try {
    const q = new URLSearchParams()
    if (filter.status) q.set('status', filter.status)
    if (filter.responsible_user_id) q.set('responsible_user_id', filter.responsible_user_id)
    rows.value = await api<InspectionListRow[]>('GET', `/api/inspections?${q}`)
    loadError.value = ''
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}
watch(() => [filter.status, filter.responsible_user_id], load)
onMounted(load)

const shown = computed(() => {
  const s = filter.search.trim().toLowerCase()
  if (!s) return rows.value
  return rows.value.filter((r) => `${r.project_number} ${r.project_name} ${r.name} ${r.location ?? ''}`.toLowerCase().includes(s))
})
const people = computed(() => users.value.filter((u) => u.active !== false && ['admin', 'member', 'employee'].includes(u.role ?? '')))
</script>

<template>
  <section class="ik-panel">
    <div class="toolbar">
      <h2 class="group-title" style="margin: 0">Egenkontroller</h2>
      <div class="spacer" />
      <div class="seg" role="tablist">
        <button class="seg-btn" :class="{ active: view === 'inspections' }" @click="view = 'inspections'; openId = null">Kontroller</button>
        <button class="seg-btn" :class="{ active: view === 'deviations' }" @click="view = 'deviations'; openId = null">Avvikelser</button>
        <button class="seg-btn" :class="{ active: view === 'templates' }" @click="view = 'templates'; openId = null">Mallar</button>
      </div>
    </div>

    <template v-if="view === 'inspections'">
      <template v-if="openId">
        <div class="toolbar"><button class="plain ghost" @click="openId = null; load()">‹ Alla kontroller</button></div>
        <InspectionsInspectionForm :base="`/api/inspections/${openId}`" mode="internal" @changed="load" @open-revision="openId = $event" />
      </template>
      <template v-else>
        <div class="ik-filters">
          <input v-model="filter.search" type="search" placeholder="Sök projekt, kontroll eller plats" aria-label="Sök">
          <select v-model="filter.status" aria-label="Status">
            <option value="">Alla aktiva statusar</option>
            <option v-for="st in INSPECTION_STATUSES" :key="st" :value="st">{{ INSPECTION_STATUS_LABELS[st] }}</option>
          </select>
          <select v-model="filter.responsible_user_id" aria-label="Ansvarig">
            <option value="">Alla ansvariga</option>
            <option v-for="u in people" :key="u.id" :value="String(u.id)">{{ u.username }}</option>
          </select>
        </div>
        <p v-if="loadError" class="emp-error">{{ loadError }}</p>
        <InspectionsInspectionTable
          :rows="shown"
          show-project
          :empty-text="loading ? 'Laddar…' : 'Inga kontroller. Lägg till kontroller från projektets flik Egenkontroller & checklistor.'"
          @open="openId = $event.id"
        />
      </template>
    </template>
    <InspectionsDeviationList v-else-if="view === 'deviations'" @open="(id: number) => { view = 'inspections'; openId = id }" />
    <InspectionsTemplateLibrary v-else />
  </section>
</template>
