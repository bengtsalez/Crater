<script setup lang="ts">
import type { AccountantProject } from '~/types'
import {
  accountantProjectsCsv,
  filterAccountantProjects,
  sumProjects,
  workTypeLabel,
  type AccountantStatusFilter,
  type AccountantTypeFilter,
} from '~/utils/accountant'

definePageMeta({ layout: 'accountant' })

// Skrivskyddad projektlista för redovisningskonsulten. Anropar bara
// /api/accountant/** – aldrig useAppData().loadAll().
const { api } = useApi()
const projects = useState<AccountantProject[]>('acc:projects', () => [])
const loaded = useState<boolean>('acc:loaded', () => false)
const error = ref('')
const pending = ref(false)

// Filtren ligger i state så att de finns kvar när man går tillbaka från detaljvyn.
const query = useState('acc:query', () => '')
const status = useState<AccountantStatusFilter>('acc:status', () => 'klar_att_fakturera')
const type = useState<AccountantTypeFilter>('acc:type', () => 'all')

const statusOptions: { value: AccountantStatusFilter; label: string }[] = [
  { value: 'klar_att_fakturera', label: 'Klar att fakturera' },
  { value: 'open', label: 'Ej avslutade' },
  { value: 'aktiv', label: 'Aktiv' },
  { value: 'planerad', label: 'Planerad' },
  { value: 'avslutad', label: 'Avslutad' },
  { value: 'all', label: 'Alla' },
]

const filtered = computed(() =>
  filterAccountantProjects(projects.value, { query: query.value, status: status.value, type: type.value })
)
const totals = computed(() => sumProjects(filtered.value))
const readyCount = computed(() => projects.value.filter((p) => p.status === 'klar_att_fakturera').length)

async function load() {
  pending.value = true
  try {
    const res = await api<{ projects: AccountantProject[] }>('GET', '/api/accountant/projects')
    projects.value = res.projects
    loaded.value = true
    error.value = ''
  } catch (err) {
    error.value = (err as Error).message || 'Kunde inte hämta projekten.'
  } finally {
    pending.value = false
  }
}

function exportCsv() {
  const blob = new Blob([accountantProjectsCsv(filtered.value)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `projekt-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function period(p: AccountantProject): string {
  if (!p.start_date && !p.end_date) return '–'
  return `${p.start_date || '?'} – ${p.end_date || '?'}`
}

onMounted(load)
</script>

<template>
  <section>
    <h1 class="emp-h1">Projekt</h1>
    <p class="emp-sub">
      Alla projekt och ströjobb med kunduppgifter. Klara att fakturera: {{ readyCount }} st.
    </p>

    <p v-if="error" class="emp-error" role="alert">
      {{ error }}
      <button class="plain" @click="load">Försök igen</button>
    </p>

    <div class="toolbar">
      <label class="filter-label">Sök:
        <input v-model="query" type="text" placeholder="Projektnr, namn, kund, org.nr…">
      </label>
      <label class="filter-label">Status:
        <select v-model="status">
          <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <label class="filter-label">Typ:
        <select v-model="type">
          <option value="all">Alla</option>
          <option value="project">Projekt</option>
          <option value="small_job">Ströjobb</option>
        </select>
      </label>
      <div class="spacer" />
      <button class="plain" :disabled="pending" @click="load">Uppdatera</button>
      <button class="plain primary" :disabled="!filtered.length" @click="exportCsv">Exportera CSV</button>
    </div>

    <p v-if="pending && !loaded" class="empty-state">Laddar projekt…</p>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>Projektnr</th>
          <th>Namn</th>
          <th>Kund</th>
          <th>Org.nr</th>
          <th>Status</th>
          <th class="acc-num">Belopp</th>
          <th class="acc-num">ÄTA</th>
          <th class="acc-num">Utgifter</th>
          <th>Period</th>
          <th>Projektledare</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!filtered.length">
          <td colspan="10" class="empty-state">Inga projekt matchar filtret.</td>
        </tr>
        <tr
          v-for="p in filtered"
          :key="p.id"
          class="clickable"
          @click="navigateTo(`/redovisning/projekt/${p.id}`)"
        >
          <td data-label="Projektnr">{{ p.project_number }}</td>
          <td data-label="Namn"><span>
            <NuxtLink :to="`/redovisning/projekt/${p.id}`" class="acc-link" @click.stop>{{ p.name }}</NuxtLink>
            <span v-if="p.work_type === 'small_job'" class="hint">
              · {{ workTypeLabel(p) }}<template v-if="p.billing_type !== 'billable'">, {{ BILLING_TYPE_LABELS[p.billing_type] }}</template>
            </span>
          </span></td>
          <td data-label="Kund"><span>{{ p.customer_name || '–' }}<span v-if="p.customer_city" class="hint"> · {{ p.customer_city }}</span></span></td>
          <td data-label="Org.nr">{{ p.customer_organization_number || '–' }}</td>
          <td data-label="Status"><span class="badge" :class="p.status">{{ STATUS_LABELS[p.status] || p.status }}</span></td>
          <td data-label="Belopp" class="acc-num">{{ formatSum(p.sum) }}</td>
          <td data-label="ÄTA" class="acc-num">{{ p.ata_total ? formatSum(p.ata_total) : '–' }}</td>
          <td data-label="Utgifter" class="acc-num">{{ p.expense_total ? formatSum(p.expense_total) : '–' }}</td>
          <td data-label="Period">{{ period(p) }}</td>
          <td data-label="Projektledare">{{ p.project_manager_username || '–' }}</td>
        </tr>
      </tbody>
      <tfoot v-if="filtered.length">
        <tr class="acc-total">
          <td colspan="5" data-label="">Summa ({{ filtered.length }} st)</td>
          <td data-label="Belopp" class="acc-num">{{ formatSum(totals.sum) }}</td>
          <td data-label="ÄTA" class="acc-num">{{ formatSum(totals.ata) }}</td>
          <td data-label="Utgifter" class="acc-num">{{ formatSum(totals.expense) }}</td>
          <td colspan="2" />
        </tr>
      </tfoot>
    </table>
  </section>
</template>
