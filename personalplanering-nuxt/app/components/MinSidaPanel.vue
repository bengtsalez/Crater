<script setup lang="ts">
import type { Task } from '~/types'
import { formatSum } from '~/utils/format'

const { projects, tasks, currentUser, loadAll } = useAppData()
const { myTasksProjectFilter } = useUiState()
const { openTaskModal } = useModals()
const { api } = useApi()
const toast = useToast()

const myProjects = computed(() =>
  projects.value.filter((p) => currentUser.value && p.project_manager_user_id === currentUser.value.id)
)
const projectCount = computed(() => myProjects.value.length)
const projectSum = computed(() => myProjects.value.reduce((s, p) => s + (p.sum || 0), 0))

const filterProject = computed(() =>
  myTasksProjectFilter.value
    ? projects.value.find((p) => p.id === myTasksProjectFilter.value) || null
    : null
)

const filteredTasks = computed(() =>
  myTasksProjectFilter.value
    ? tasks.value.filter((t) => t.project_id === myTasksProjectFilter.value)
    : tasks.value
)
const activeTasks = computed(() => filteredTasks.value.filter((t) => t.status !== 'avslutad'))
const doneTasks = computed(() => filteredTasks.value.filter((t) => t.status === 'avslutad'))

async function toggle(t: Task) {
  const newStatus = t.status === 'avslutad' ? 'aktiv' : 'avslutad'
  try {
    await api('PUT', `/api/tasks/${t.id}`, { status: newStatus })
    await loadAll()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}

async function remove(t: Task) {
  if (!confirm('Ta bort uppgiften?')) return
  try {
    await api('DELETE', `/api/tasks/${t.id}`)
    await loadAll()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}
</script>

<template>
  <section>
    <div class="ms-overview">
      <div class="ms-stat">
        <div class="ms-stat-value">{{ projectCount }}</div>
        <div class="ms-stat-label">Projekt som projektledare</div>
      </div>
      <div class="ms-stat">
        <div class="ms-stat-value">{{ formatSum(projectSum) }}</div>
        <div class="ms-stat-label">Totalt projektvärde</div>
      </div>
    </div>

    <div v-if="filterProject" class="toolbar">
      <span class="filter-label">Filtrerat på projekt:
        <strong>{{ filterProject.project_number }} – {{ filterProject.name }}</strong>
      </span>
      <button class="plain ghost" @click="myTasksProjectFilter = null">Rensa filter</button>
      <div class="spacer" />
    </div>

    <div class="toolbar">
      <h2 class="group-title" style="margin: 0">Mina uppgifter</h2>
      <div class="spacer" />
      <button class="plain primary" @click="openTaskModal(null)">+ Ny uppgift</button>
    </div>

    <h3 class="group-title">Aktiva</h3>
    <div class="task-list">
      <div v-if="!activeTasks.length" class="empty-state">Inga aktiva uppgifter.</div>
      <TaskRow
        v-for="t in activeTasks"
        :key="t.id"
        :task="t"
        @toggle="toggle"
        @edit="openTaskModal($event)"
        @delete="remove"
      />
    </div>

    <h3 class="group-title">Slutförda</h3>
    <div class="task-list">
      <div v-if="!doneTasks.length" class="empty-state">Inga slutförda uppgifter.</div>
      <TaskRow
        v-for="t in doneTasks"
        :key="t.id"
        :task="t"
        @toggle="toggle"
        @edit="openTaskModal($event)"
        @delete="remove"
      />
    </div>
  </section>
</template>
