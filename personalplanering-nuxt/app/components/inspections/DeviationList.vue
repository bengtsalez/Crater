<script setup lang="ts">
import { DEVIATION_STATUS_LABELS, DEVIATION_STATUSES } from '../../../shared/inspections'
import type { DeviationListRow } from '../../../shared/inspectionTypes'

// Samlad avvikelselista med filter på projekt, ansvarig och status.
const emit = defineEmits<{ open: [inspectionId: number] }>()
const { api } = useApi()
const { users, projects } = useAppData()
const rows = ref<DeviationListRow[]>([])
const loadError = ref('')
const loading = ref(false)
const filter = reactive({ status: 'unverified', project_id: '', responsible_user_id: '' })

async function load() {
  loading.value = true
  try {
    const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][])
    rows.value = await api<DeviationListRow[]>('GET', `/api/inspection-deviations?${q}`)
    loadError.value = ''
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}
watch(filter, load, { immediate: true })
const people = computed(() => users.value.filter((u) => u.active !== false && ['admin', 'member', 'employee'].includes(u.role ?? '')))
const projectOptions = computed(() => [...projects.value].sort((a, b) => a.project_number.localeCompare(b.project_number, 'sv', { numeric: true })))
</script>

<template>
  <div>
    <div class="ik-filters">
      <select v-model="filter.status" aria-label="Status">
        <option value="unverified">Ej verifierade</option>
        <option v-for="s in DEVIATION_STATUSES" :key="s" :value="s">{{ DEVIATION_STATUS_LABELS[s] }}</option>
        <option value="">Alla</option>
      </select>
      <select v-model="filter.project_id" aria-label="Projekt">
        <option value="">Alla projekt</option>
        <option v-for="p in projectOptions" :key="p.id" :value="String(p.id)">{{ p.project_number }} – {{ p.name }}</option>
      </select>
      <select v-model="filter.responsible_user_id" aria-label="Ansvarig">
        <option value="">Alla ansvariga</option>
        <option v-for="u in people" :key="u.id" :value="String(u.id)">{{ u.username }}</option>
      </select>
    </div>
    <p v-if="loadError" class="emp-error">{{ loadError }}</p>
    <table class="data-table">
      <thead><tr><th>Projekt</th><th>Kontroll</th><th>Punkt</th><th>Beskrivning</th><th>Ansvarig</th><th>Sista datum</th><th>Status</th></tr></thead>
      <tbody>
        <tr v-if="!rows.length"><td colspan="7" class="empty-state">{{ loading ? 'Laddar…' : 'Inga avvikelser med valda filter.' }}</td></tr>
        <tr v-for="d in rows" :key="d.id" class="clickable" @click="emit('open', d.inspection_id)">
          <td data-label="Projekt">{{ d.project_number }} – {{ d.project_name }}</td>
          <td data-label="Kontroll">{{ d.inspection_name }}<span v-if="d.inspection_location" class="hint"> · {{ d.inspection_location }}</span></td>
          <td data-label="Punkt">{{ d.item_title }}</td>
          <td data-label="Beskrivning">{{ d.description }}</td>
          <td data-label="Ansvarig">{{ d.responsible_name || '–' }}</td>
          <td data-label="Sista datum">{{ d.due_date || '–' }}</td>
          <td data-label="Status"><InspectionsStatusBadge :status="d.status" deviation /></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
