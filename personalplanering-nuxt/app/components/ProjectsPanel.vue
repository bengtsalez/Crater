<script setup lang="ts">
import type { Project } from '~/types'
import type { DropdownMenuItem } from '@nuxt/ui'
import { compareProjects, effectiveStart } from '~/utils/analytics'
import { formatSum } from '~/utils/format'
import { STATUS_LABELS } from '~/utils/constants'

const { projects, assignments } = useAppData()
const { labelFor: departmentLabel, options: departmentOptions } = useDepartments()
const { openProjectDetail } = useUiState()
const { openProjectModal } = useModals()
const { setStatus, remove } = useProjectActions()

const search = ref('')
const sortColumn = ref('project_number')
const sortDirection = ref<'asc' | 'desc'>('asc')

const departmentFilter = ref('')
const statusFilter = ref('')
const managerFilter = ref('')

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

const managerOptions = computed(() =>
  [...new Set(projects.value.map((p) => p.project_manager_username).filter(Boolean) as string[])].sort(
    (a, b) => a.localeCompare(b, 'sv')
  )
)

const showDoneTable = computed(() => !statusFilter.value || statusFilter.value === 'avslutad')

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
  return [
    p.name,
    p.client,
    p.project_number,
    p.project_manager_username,
    departmentLabel(p.category),
    p.notes,
  ].some((v) => String(v ?? '').toLowerCase().includes(q))
}

function matchesFilters(p: Project) {
  if (departmentFilter.value && p.category !== departmentFilter.value) return false
  if (statusFilter.value && p.status !== statusFilter.value) return false
  if (managerFilter.value && p.project_manager_username !== managerFilter.value) return false
  return true
}

function sortList(list: Project[]) {
  const sorted = [...list].sort((a, b) => compareProjects(assignments.value, a, b, sortColumn.value))
  return sortDirection.value === 'desc' ? sorted.reverse() : sorted
}

const visible = computed(() =>
  projects.value.filter((p) => matchesQuery(p) && matchesFilters(p))
)
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

function rowActions(p: Project): DropdownMenuItem[][] {
  const statusAction: DropdownMenuItem =
    p.status === 'avslutad'
      ? { label: 'Återaktivera', onSelect: () => setStatus(p.id, 'aktiv') }
      : { label: 'Markera avslutad', onSelect: () => setStatus(p.id, 'avslutad') }
  return [
    [
      { label: 'Redigera', onSelect: () => openProjectModal(p) },
      statusAction,
    ],
    [
      { label: 'Ta bort', color: 'error', onSelect: () => remove(p) },
    ],
  ]
}
</script>

<template>
  <section>
    <div class="toolbar">
      <label class="filter-label">Sök:
        <input v-model="search" type="text" placeholder="Namn, kund, projektnr, projektledare...">
      </label>
      <label class="filter-label">Avdelning:
        <select v-model="departmentFilter">
          <option value="">Alla</option>
          <option v-for="d in departmentOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
        </select>
      </label>
      <label class="filter-label">Status:
        <select v-model="statusFilter">
          <option value="">Alla</option>
          <option v-for="(label, key) in STATUS_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <label class="filter-label">Projektledare:
        <select v-model="managerFilter">
          <option value="">Alla</option>
          <option v-for="m in managerOptions" :key="m" :value="m">{{ m }}</option>
        </select>
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
          <th>Status</th>
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
          <td data-label="Projektnr">{{ p.project_number }}</td>
          <td data-label="Namn">{{ p.name }}</td>
          <td data-label="Kund">{{ p.client || '–' }}</td>
          <td data-label="Kategori">{{ departmentLabel(p.category) }}</td>
          <td data-label="Projektledare">{{ p.project_manager_username || '–' }}</td>
          <td data-label="Summa">{{ formatSum(p.sum) }}</td>
          <td data-label="Byggstart" :title="startInfo(p).title">
            {{ startInfo(p).text }}<span v-if="startInfo(p).prel" class="hint"> (prel.)</span>
          </td>
          <td data-label="Byggslut">{{ p.end_date || '–' }}</td>
          <td data-label="Status">
            <span class="badge" :class="p.status">{{ STATUS_LABELS[p.status] || p.status }}</span>
            <span v-if="p.status_override" class="hint" title="Manuellt tvingad status"> (manuell)</span>
          </td>
          <td data-label="">
            <UDropdownMenu :items="rowActions(p)" :content="{ align: 'end' }">
              <button class="plain" aria-label="Fler åtgärder" @click.stop>⋯</button>
            </UDropdownMenu>
          </td>
        </tr>
      </tbody>
    </table>

    <template v-if="showDoneTable">
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
            <td data-label="Projektnr">{{ p.project_number }}</td>
            <td data-label="Namn">{{ p.name }}</td>
            <td data-label="Kund">{{ p.client || '–' }}</td>
            <td data-label="Kategori">{{ departmentLabel(p.category) }}</td>
            <td data-label="Projektledare">{{ p.project_manager_username || '–' }}</td>
            <td data-label="Summa">{{ formatSum(p.sum) }}</td>
            <td data-label="Byggstart" :title="startInfo(p).title">
              {{ startInfo(p).text }}<span v-if="startInfo(p).prel" class="hint"> (prel.)</span>
            </td>
            <td data-label="Byggslut">{{ p.end_date || '–' }}</td>
            <td data-label="">
              <UDropdownMenu :items="rowActions(p)" :content="{ align: 'end' }">
                <button class="plain" aria-label="Fler åtgärder" @click.stop>⋯</button>
              </UDropdownMenu>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
