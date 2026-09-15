<script setup lang="ts">
import type { Task, LineItem, Project } from '~/types'
import { effectiveStart } from '~/utils/analytics'
import { formatSum } from '~/utils/format'
import { STATUS_LABELS } from '~/utils/constants'
import { BILLING_TYPE_LABELS } from '~/utils/projects'
import { projectCustomerName } from '~/utils/customers'

const { projects, assignments, customers, currentUser, loadAll } = useAppData()
const { projectDetailId, projectDetailBackLabel, closeProjectDetail, openProjectDetail, openCustomerDetail } = useUiState()
const { openProjectModal, openLineItemModal, openTaskModal } = useModals()
const { lineItems, tasks, refresh } = useProjectDetail()
const { api } = useApi()
const toast = useToast()

const project = computed(() => projects.value.find((p) => p.id === projectDetailId.value) || null)
const customer = computed(() => customers.value.find((c) => c.id === project.value?.customer_id) || null)
const detailIsSmallJob = computed(() => project.value?.work_type === 'small_job')

const relatedJobs = computed(() =>
  project.value
    ? [...projects.value]
        .filter((p) => p.source_project_id === project.value!.id)
        .sort((a, b) => a.project_number.localeCompare(b.project_number, 'sv'))
    : []
)
const sourceProject = computed(() =>
  project.value?.source_project_id ? projects.value.find((p) => p.id === project.value!.source_project_id) || null : null
)

function relatedJobDate(job: Project) {
  return effectiveStart(assignments.value, job).date || job.start_date || '–'
}

watch(
  projectDetailId,
  (id) => {
    if (id) refresh()
  },
  { immediate: true }
)

// Stäng om projektet försvinner (t.ex. raderat).
watch(project, (p) => {
  if (projectDetailId.value && !p) closeProjectDetail()
})

const es = computed(() => (project.value ? effectiveStart(assignments.value, project.value) : null))
const showPrel = computed(() => !!es.value?.preliminary && es.value.preliminary !== es.value.date)

const ata = computed(() => lineItems.value.filter((li) => li.type === 'ata'))
const expenses = computed(() => lineItems.value.filter((li) => li.type === 'utgift'))
const baseSum = computed(() => project.value?.sum || 0)
const ataTotal = computed(() => ata.value.reduce((s, li) => s + li.amount, 0))
const expenseTotal = computed(() => expenses.value.reduce((s, li) => s + li.amount, 0))
const revenue = computed(() => baseSum.value + ataTotal.value)
const result = computed(() => revenue.value - expenseTotal.value)

const staff = computed(() =>
  assignments.value
    .filter((a) => a.project_id === project.value?.id)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
)

function isOwn(t: Task) {
  return !!currentUser.value && t.user_id === currentUser.value.id
}

async function deleteLineItem(li: LineItem) {
  if (!confirm('Ta bort raden?')) return
  try {
    await api('DELETE', `/api/line-items/${li.id}`)
    await refresh()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}

async function toggleTask(t: Task) {
  const newStatus = t.status === 'avslutad' ? 'aktiv' : 'avslutad'
  try {
    await api('PUT', `/api/tasks/${t.id}`, { status: newStatus })
    await loadAll()
    await refresh()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}

async function deleteTask(t: Task) {
  if (!confirm('Ta bort uppgiften?')) return
  try {
    await api('DELETE', `/api/tasks/${t.id}`)
    await loadAll()
    await refresh()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}
</script>

<template>
  <section v-if="project">
    <div class="toolbar">
      <button class="plain ghost" @click="closeProjectDetail()">{{ projectDetailBackLabel }}</button>
      <div class="spacer" />
      <button class="plain primary" @click="openProjectModal(project)">Redigera projekt</button>
    </div>

    <div class="pd-header">
      <h2 class="pd-title">{{ project.project_number }} – {{ project.name }}</h2>
      <span class="badge" :class="project.status">{{ STATUS_LABELS[project.status] || project.status }}</span>
      <span v-if="project.status_override" class="hint" title="Manuellt tvingad status">manuell</span>
    </div>
    <div class="pd-meta">
      <span>Kund:
        <button v-if="project.customer_id" type="button" class="link-button" @click="openCustomerDetail(project.customer_id)">
          {{ projectCustomerName(project) }}
        </button>
        <template v-else>{{ projectCustomerName(project) || '–' }}</template>
      </span>
      <span v-if="customer?.phone">Tel: {{ customer.phone }}</span>
      <span v-if="customer?.email">E-post: {{ customer.email }}</span>
      <span>Projektledare: {{ project.project_manager_username || '–' }}</span>
      <template v-if="es && es.planned">
        <span>Byggstart (inplanerad): {{ es.date }}</span>
        <span v-if="showPrel" class="pd-meta-muted">Preliminär start: {{ es.preliminary }}</span>
      </template>
      <span v-else>Byggstart (preliminär): {{ es?.date || '–' }}</span>
      <span>Byggslut: {{ project.end_date || '–' }}</span>
      <span v-if="detailIsSmallJob">Typ: {{ BILLING_TYPE_LABELS[project.billing_type] || project.billing_type }}</span>
    </div>

    <div v-if="sourceProject" class="pd-meta">
      <span>
        Relaterat projekt:
        <button type="button" class="link-button" @click="openProjectDetail(sourceProject.id)">
          {{ sourceProject.project_number }} – {{ sourceProject.name }}
        </button>
      </span>
    </div>

    <template v-if="!detailIsSmallJob">
      <div class="ms-overview">
        <div class="ms-stat"><div class="ms-stat-value">{{ formatSum(baseSum) }}</div><div class="ms-stat-label">Kontraktssumma</div></div>
        <div class="ms-stat"><div class="ms-stat-value">{{ formatSum(ataTotal) }}</div><div class="ms-stat-label">ÄTA-tillägg</div></div>
        <div class="ms-stat"><div class="ms-stat-value">{{ formatSum(revenue) }}</div><div class="ms-stat-label">Intäkter totalt</div></div>
        <div class="ms-stat"><div class="ms-stat-value">{{ formatSum(expenseTotal) }}</div><div class="ms-stat-label">Utgifter totalt</div></div>
        <div class="ms-stat"><div class="ms-stat-value">{{ formatSum(result) }}</div><div class="ms-stat-label">Resultat</div></div>
      </div>

      <div class="toolbar">
        <h3 class="group-title" style="margin: 0">ÄTA-arbeten</h3>
        <div class="spacer" />
        <button class="plain primary" @click="openLineItemModal('ata', null, project.id)">+ Ny ÄTA</button>
      </div>
      <table class="data-table">
        <thead><tr><th>Beskrivning</th><th>Datum</th><th>Belopp</th><th /></tr></thead>
        <tbody>
          <tr v-if="!ata.length"><td colspan="4" class="empty-state">Inga rader ännu.</td></tr>
          <tr v-for="li in ata" :key="li.id" class="clickable" @click="openLineItemModal('ata', li, project.id)">
            <td data-label="Beskrivning">{{ li.description }}</td>
            <td data-label="Datum">{{ li.date || '–' }}</td>
            <td data-label="Belopp">{{ formatSum(li.amount) }}</td>
            <td data-label=""><button class="plain danger" @click.stop="deleteLineItem(li)">Ta bort</button></td>
          </tr>
        </tbody>
      </table>

      <div class="toolbar">
        <h3 class="group-title" style="margin: 0">Utgifter</h3>
        <div class="spacer" />
        <button class="plain primary" @click="openLineItemModal('utgift', null, project.id)">+ Ny utgift</button>
      </div>
      <table class="data-table">
        <thead><tr><th>Beskrivning</th><th>Datum</th><th>Belopp</th><th /></tr></thead>
        <tbody>
          <tr v-if="!expenses.length"><td colspan="4" class="empty-state">Inga rader ännu.</td></tr>
          <tr v-for="li in expenses" :key="li.id" class="clickable" @click="openLineItemModal('utgift', li, project.id)">
            <td data-label="Beskrivning">{{ li.description }}</td>
            <td data-label="Datum">{{ li.date || '–' }}</td>
            <td data-label="Belopp">{{ formatSum(li.amount) }}</td>
            <td data-label=""><button class="plain danger" @click.stop="deleteLineItem(li)">Ta bort</button></td>
          </tr>
        </tbody>
      </table>

      <h3 class="group-title">Relaterade arbeten</h3>
      <table class="data-table">
        <thead><tr><th>Jobb</th><th>Typ</th><th>Datum</th></tr></thead>
        <tbody>
          <tr v-if="!relatedJobs.length"><td colspan="3" class="empty-state">Inga relaterade ströjobb.</td></tr>
          <tr v-for="job in relatedJobs" :key="job.id" class="clickable" @click="openProjectDetail(job.id)">
            <td data-label="Jobb">{{ job.project_number }} – {{ job.name }}</td>
            <td data-label="Typ">{{ BILLING_TYPE_LABELS[job.billing_type] || job.billing_type }}</td>
            <td data-label="Datum">{{ relatedJobDate(job) }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <h3 class="group-title">Inplanerad personal</h3>
    <table class="data-table">
      <thead><tr><th>Namn</th><th>Typ</th><th>Från</th><th>Till</th></tr></thead>
      <tbody>
        <tr v-if="!staff.length"><td colspan="4" class="empty-state">Ingen personal inplanerad ännu.</td></tr>
        <tr v-for="a in staff" :key="a.id">
          <td data-label="Namn">{{ a.resource_name }}</td>
          <td data-label="Typ">{{ a.resource_type === 'anstalld' ? 'Anställd' : 'Underentreprenör' }}</td>
          <td data-label="Från">{{ a.start_date }}</td>
          <td data-label="Till">{{ a.end_date }}</td>
        </tr>
      </tbody>
    </table>

    <div class="toolbar">
      <h3 class="group-title" style="margin: 0">Uppgifter</h3>
      <div class="spacer" />
      <button class="plain primary" @click="openTaskModal(null, project.id)">+ Ny uppgift</button>
    </div>
    <div class="task-list">
      <div v-if="!tasks.length" class="empty-state">Inga uppgifter kopplade till projektet ännu.</div>
      <TaskRow
        v-for="t in tasks"
        :key="t.id"
        :task="t"
        show-owner
        :read-only="!isOwn(t)"
        @toggle="toggleTask"
        @edit="openTaskModal($event)"
        @delete="deleteTask"
      />
    </div>
  </section>
</template>
