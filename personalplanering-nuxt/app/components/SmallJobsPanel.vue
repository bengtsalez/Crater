<script setup lang="ts">
import type { Project } from '~/types'
import type { DropdownMenuItem } from '@nuxt/ui'
import { compareProjects, effectiveStart } from '~/utils/analytics'
import { BILLING_TYPE_LABELS } from '~/utils/projects'
import { STATUS_LABELS } from '~/utils/constants'
import { projectCustomerName } from '~/utils/customers'

const { projects, assignments } = useAppData()
const { labelFor: departmentLabel, options: departmentOptions } = useDepartments()
const { openProjectDetail } = useUiState()
const { openQuickJobModal } = useModals()
const { setStatus, remove } = useProjectActions()

const search = ref('')
const sortColumn = ref('project_number')
const sortDirection = ref<'asc' | 'desc'>('asc')

const departmentFilter = ref('')
const billingFilter = ref('')
const managerFilter = ref('')

const columns = [
  { key: 'project_number', label: 'Nummer' },
  { key: 'client', label: 'Kund' },
  { key: 'name', label: 'Arbete' },
  { key: 'billing_type', label: 'Typ' },
  { key: 'category', label: 'Avdelning' },
  { key: 'project_manager_username', label: 'Ansvarig' },
]

const smallJobs = computed(() => projects.value.filter((p) => p.work_type === 'small_job'))
const projectMap = computed(() => new Map(projects.value.map((p) => [p.id, p])))

const managerOptions = computed(() =>
  [...new Set(smallJobs.value.map((p) => p.project_manager_username).filter(Boolean) as string[])].sort(
    (a, b) => a.localeCompare(b, 'sv')
  )
)

function toggleSort(field: string) {
  if (sortColumn.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortColumn.value = field
    sortDirection.value = 'asc'
  }
}

function sourceProjectNumber(p: Project) {
  return p.source_project_id ? projectMap.value.get(p.source_project_id)?.project_number ?? '' : ''
}

function matchesQuery(p: Project) {
  const q = search.value.trim().toLowerCase()
  if (!q) return true
  return [projectCustomerName(p), p.name, p.project_number, p.notes, sourceProjectNumber(p)].some((v) =>
    String(v ?? '').toLowerCase().includes(q)
  )
}

function matchesFilters(p: Project) {
  if (departmentFilter.value && p.category !== departmentFilter.value) return false
  if (billingFilter.value && p.billing_type !== billingFilter.value) return false
  if (managerFilter.value && p.project_manager_username !== managerFilter.value) return false
  return true
}

function sortList(list: Project[]) {
  const sorted = [...list].sort((a, b) => compareProjects(assignments.value, a, b, sortColumn.value))
  return sortDirection.value === 'desc' ? sorted.reverse() : sorted
}

const visible = computed(() => smallJobs.value.filter((p) => matchesQuery(p) && matchesFilters(p)))
const toPlanJobs = computed(() => sortList(visible.value.filter((p) => p.status === 'aktiv')))
const plannedJobs = computed(() => sortList(visible.value.filter((p) => p.status === 'planerad')))
const doneJobs = computed(() =>
  sortList(visible.value.filter((p) => p.status === 'klar_att_fakturera' || p.status === 'avslutad'))
)

function plannedDate(p: Project) {
  return effectiveStart(assignments.value, p).date || '–'
}

function rowActions(p: Project): DropdownMenuItem[][] {
  const statusAction: DropdownMenuItem =
    p.status === 'avslutad'
      ? { label: 'Återaktivera', onSelect: () => setStatus(p.id, 'aktiv') }
      : { label: 'Markera avslutad', onSelect: () => setStatus(p.id, 'avslutad') }
  return [
    [statusAction],
    [{ label: 'Ta bort', color: 'error', onSelect: () => remove(p) }],
  ]
}
</script>

<template>
  <section>
    <div class="toolbar">
      <label class="filter-label">Sök:
        <input v-model="search" type="text" placeholder="Kund, arbete, nummer, anteckningar...">
      </label>
      <label class="filter-label">Avdelning:
        <select v-model="departmentFilter">
          <option value="">Alla</option>
          <option v-for="d in departmentOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
        </select>
      </label>
      <label class="filter-label">Typ:
        <select v-model="billingFilter">
          <option value="">Alla</option>
          <option v-for="(label, key) in BILLING_TYPE_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <label class="filter-label">Ansvarig:
        <select v-model="managerFilter">
          <option value="">Alla</option>
          <option v-for="m in managerOptions" :key="m" :value="m">{{ m }}</option>
        </select>
      </label>
      <div class="spacer" />
      <button class="plain primary" @click="openQuickJobModal()">+ Nytt ströjobb</button>
    </div>

    <h2 class="group-title">Att planera</h2>
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
          <th>Relaterat projekt</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-if="!toPlanJobs.length"><td colspan="8" class="empty-state">Inga ströjobb att planera.</td></tr>
        <tr v-for="p in toPlanJobs" :key="p.id" class="clickable" @click="openProjectDetail(p.id)">
          <td data-label="Nummer">{{ p.project_number }}</td>
          <td data-label="Kund">{{ projectCustomerName(p) || '–' }}</td>
          <td data-label="Arbete">{{ p.name }}</td>
          <td data-label="Typ">{{ BILLING_TYPE_LABELS[p.billing_type] || p.billing_type }}</td>
          <td data-label="Avdelning">{{ departmentLabel(p.category) }}</td>
          <td data-label="Ansvarig">{{ p.project_manager_username || '–' }}</td>
          <td data-label="Relaterat projekt">{{ sourceProjectNumber(p) || '–' }}</td>
          <td data-label="">
            <UDropdownMenu :items="rowActions(p)" :content="{ align: 'end' }">
              <button class="plain" aria-label="Fler åtgärder" @click.stop>⋯</button>
            </UDropdownMenu>
          </td>
        </tr>
      </tbody>
    </table>

    <h2 class="group-title">Planerade</h2>
    <table class="data-table sortable">
      <thead>
        <tr>
          <th v-for="c in columns" :key="c.key">{{ c.label }}</th>
          <th>Planerat datum</th>
          <th>Relaterat projekt</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-if="!plannedJobs.length"><td colspan="9" class="empty-state">Inga planerade ströjobb.</td></tr>
        <tr v-for="p in plannedJobs" :key="p.id" class="clickable" @click="openProjectDetail(p.id)">
          <td data-label="Nummer">{{ p.project_number }}</td>
          <td data-label="Kund">{{ projectCustomerName(p) || '–' }}</td>
          <td data-label="Arbete">{{ p.name }}</td>
          <td data-label="Typ">{{ BILLING_TYPE_LABELS[p.billing_type] || p.billing_type }}</td>
          <td data-label="Avdelning">{{ departmentLabel(p.category) }}</td>
          <td data-label="Ansvarig">{{ p.project_manager_username || '–' }}</td>
          <td data-label="Planerat datum">{{ plannedDate(p) }}</td>
          <td data-label="Relaterat projekt">{{ sourceProjectNumber(p) || '–' }}</td>
          <td data-label="">
            <UDropdownMenu :items="rowActions(p)" :content="{ align: 'end' }">
              <button class="plain" aria-label="Fler åtgärder" @click.stop>⋯</button>
            </UDropdownMenu>
          </td>
        </tr>
      </tbody>
    </table>

    <h2 class="group-title">Utförda</h2>
    <table class="data-table sortable">
      <thead>
        <tr>
          <th>Status</th>
          <th v-for="c in columns" :key="c.key">{{ c.label }}</th>
          <th>Relaterat projekt</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-if="!doneJobs.length"><td colspan="9" class="empty-state">Inga utförda ströjobb.</td></tr>
        <tr v-for="p in doneJobs" :key="p.id" class="clickable" @click="openProjectDetail(p.id)">
          <td data-label="Status">
            <span class="badge" :class="p.status">{{ STATUS_LABELS[p.status] || p.status }}</span>
          </td>
          <td data-label="Nummer">{{ p.project_number }}</td>
          <td data-label="Kund">{{ projectCustomerName(p) || '–' }}</td>
          <td data-label="Arbete">{{ p.name }}</td>
          <td data-label="Typ">{{ BILLING_TYPE_LABELS[p.billing_type] || p.billing_type }}</td>
          <td data-label="Avdelning">{{ departmentLabel(p.category) }}</td>
          <td data-label="Ansvarig">{{ p.project_manager_username || '–' }}</td>
          <td data-label="Relaterat projekt">{{ sourceProjectNumber(p) || '–' }}</td>
          <td data-label="">
            <UDropdownMenu :items="rowActions(p)" :content="{ align: 'end' }">
              <button class="plain" aria-label="Fler åtgärder" @click.stop>⋯</button>
            </UDropdownMenu>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
