<script setup lang="ts">
import type { Project } from '~/types'
import { compareProjects, effectiveStart } from '~/utils/analytics'
import { formatSum } from '~/utils/format'
import { STATUS_LABELS } from '~/utils/constants'

const { projects, assignments, loadAll } = useAppData()
const { labelFor: departmentLabel } = useDepartments()
const { openProjectDetail } = useUiState()
const { openProjectModal } = useModals()
const { api } = useApi()
const toast = useToast()

const search = ref('')
const sortColumn = ref('project_number')
const sortDirection = ref<'asc' | 'desc'>('asc')

const columns = [
  { key: 'project_number', label: 'Projektnr' },
  { key: 'name', label: 'Namn' },
  { key: 'client', label: 'Kund' },
  { key: 'category', label: 'Kategori' },
  { key: 'project_manager_username', label: 'Projektledare' },
  { key: 'sum', label: 'Summa' },
  { key: 'start_date', label: 'Byggstart' },
  { key: 'end_date', label: 'Byggslut' },
]

function toggleSort(field: string) {
  if (sortColumn.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortColumn.value = field
    sortDirection.value = 'asc'
  }
}

function matchesQuery(p: Project) {
  const q = search.value.trim().toLowerCase()
  if (!q) return true
  return [p.name, p.client, p.project_number].some((v) => String(v ?? '').toLowerCase().includes(q))
}

function sortList(list: Project[]) {
  const sorted = [...list].sort((a, b) => compareProjects(assignments.value, a, b, sortColumn.value))
  return sortDirection.value === 'desc' ? sorted.reverse() : sorted
}

const visible = computed(() => projects.value.filter(matchesQuery))
const activeProjects = computed(() => sortList(visible.value.filter((p) => p.status !== 'avslutad')))
const doneProjects = computed(() => sortList(visible.value.filter((p) => p.status === 'avslutad')))

function startInfo(p: Project) {
  const es = effectiveStart(assignments.value, p)
  if (!es.date) return { text: '–', title: '', prel: false }
  const showPrel = es.preliminary && es.preliminary !== es.date
  const title = es.planned
    ? 'Inplanerat startdatum (tidigaste bokningen)' + (showPrel ? ` · preliminär: ${es.preliminary}` : '')
    : 'Preliminärt startdatum – projektet är inte inplanerat ännu'
  return { text: es.date, title, prel: !es.planned }
}

async function deleteProject(id: number) {
  if (!confirm('Ta bort projektet?')) return
  try {
    await api('DELETE', `/api/projects/${id}`)
    await loadAll()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}

async function reactivate(id: number) {
  try {
    await api('PUT', `/api/projects/${id}`, { status_override: 'aktiv' })
    await loadAll()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}
</script>

<template>
  <section>
    <div class="toolbar">
      <label class="filter-label">Sök:
        <input v-model="search" type="text" placeholder="Namn, kund, projektnr...">
      </label>
      <div class="spacer" />
      <button class="plain primary" @click="openProjectModal(null)">+ Nytt projekt</button>
    </div>

    <table class="data-table sortable">
      <thead>
        <tr>
          <th
            v-for="c in columns"
            :key="c.key"
            data-sort
            :class="{
              'sort-asc': sortColumn === c.key && sortDirection === 'asc',
              'sort-desc': sortColumn === c.key && sortDirection === 'desc',
            }"
            @click="toggleSort(c.key)"
          >
            {{ c.label }}
          </th>
          <th />
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-if="!activeProjects.length">
          <td colspan="10" class="empty-state">Inga projekt.</td>
        </tr>
        <tr
          v-for="p in activeProjects"
          :key="p.id"
          class="clickable"
          @click="openProjectDetail(p.id)"
        >
          <td>{{ p.project_number }}</td>
          <td>{{ p.name }}</td>
          <td>{{ p.client || '–' }}</td>
          <td>{{ departmentLabel(p.category) }}</td>
          <td>{{ p.project_manager_username || '–' }}</td>
          <td>{{ formatSum(p.sum) }}</td>
          <td :title="startInfo(p).title">
            {{ startInfo(p).text }}<span v-if="startInfo(p).prel" class="hint"> (prel.)</span>
          </td>
          <td>{{ p.end_date || '–' }}</td>
          <td>
            <span class="badge" :class="p.status">{{ STATUS_LABELS[p.status] || p.status }}</span>
            <span v-if="p.status_override" class="hint" title="Manuellt tvingad status"> (manuell)</span>
          </td>
          <td>
            <button class="plain danger" @click.stop="deleteProject(p.id)">Ta bort</button>
          </td>
        </tr>
      </tbody>
    </table>

    <h2 class="group-title">Avslutade projekt</h2>
    <table class="data-table sortable">
      <thead>
        <tr>
          <th v-for="c in columns" :key="c.key">{{ c.label }}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-if="!doneProjects.length">
          <td colspan="9" class="empty-state">Inga avslutade projekt.</td>
        </tr>
        <tr
          v-for="p in doneProjects"
          :key="p.id"
          class="clickable"
          @click="openProjectDetail(p.id)"
        >
          <td>{{ p.project_number }}</td>
          <td>{{ p.name }}</td>
          <td>{{ p.client || '–' }}</td>
          <td>{{ departmentLabel(p.category) }}</td>
          <td>{{ p.project_manager_username || '–' }}</td>
          <td>{{ formatSum(p.sum) }}</td>
          <td :title="startInfo(p).title">
            {{ startInfo(p).text }}<span v-if="startInfo(p).prel" class="hint"> (prel.)</span>
          </td>
          <td>{{ p.end_date || '–' }}</td>
          <td>
            <button class="plain ghost" @click.stop="reactivate(p.id)">Återaktivera</button>
            <button class="plain danger" @click.stop="deleteProject(p.id)">Ta bort</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
