<script setup lang="ts">
import type { StaffInfo, Task } from '~/types'

// "Information till personal" i projektdetaljen: arbetsbeskrivning som
// projektledaren publicerar för inplanerad personal + uppgifter till
// personalkonton. Hålls helt separat från projektets interna anteckningar.
// (Bilagor: uppskjutet – lägg ett block här när lagringen är beslutad.)
const props = defineProps<{ projectId: number }>()
const emit = defineEmits<{ toggleTask: [task: Task]; deleteTask: [task: Task] }>()

const { assignments, employeeUsers } = useAppData()
const { tasks } = useProjectDetail()
const { refresh: refreshActivity } = useProjectActivity()
const { openTaskModal } = useModals()
const { api } = useApi()
const toast = useToast()

const info = ref<StaffInfo | null>(null)
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const draft = reactive({ instructions: '', published: false })

const dirty = computed(
  () => !!info.value && (draft.instructions !== (info.value.instructions || '') || draft.published !== info.value.published)
)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    info.value = await api<StaffInfo>('GET', `/api/projects/${props.projectId}/staff-info`)
    draft.instructions = info.value.instructions || ''
    draft.published = info.value.published
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}
watch(() => props.projectId, load, { immediate: true })

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    info.value = await api<StaffInfo>('PUT', `/api/projects/${props.projectId}/staff-info`, {
      instructions: draft.instructions,
      published: draft.published,
    })
    draft.instructions = info.value.instructions || ''
    toast.add({ title: draft.published ? 'Sparat och synligt för personal' : 'Sparat som utkast', color: 'success' })
    await refreshActivity()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}

const updatedText = computed(() => {
  if (!info.value?.updated_at) return 'Inte sparad ännu'
  const when = new Date(info.value.updated_at).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })
  return `Senast uppdaterad ${when}${info.value.updated_by_username ? ` av ${info.value.updated_by_username}` : ''}`
})

const staffTasks = computed(() => tasks.value.filter((t) => t.user_role === 'employee'))
const doneCount = computed(() => staffTasks.value.filter((t) => t.status === 'avslutad').length)

// Förval för "+ Ny uppgift till personal": första inplanerade personen med konto.
const bookedEmployeeIds = computed(() => {
  const resIds = new Set(assignments.value.filter((a) => a.project_id === props.projectId).map((a) => a.resource_id))
  return employeeUsers.value.filter((u) => u.active !== false && u.resource_id && resIds.has(u.resource_id)).map((u) => u.id)
})

function newStaffTask() {
  openTaskModal(null, props.projectId, bookedEmployeeIds.value[0] ?? employeeUsers.value[0]?.id ?? null)
}
</script>

<template>
  <div class="staff-info">
    <div class="toolbar">
      <h3 class="group-title" style="margin: 0">Information till personal</h3>
      <span v-if="info" class="staff-badge" :class="info.published ? 'published' : 'draft'">
        {{ info.published ? 'Synlig för personal' : 'Utkast – ej synlig' }}
      </span>
      <div class="spacer" />
    </div>

    <p v-if="loadError" class="empty-state">Kunde inte hämta arbetsinformation: {{ loadError }}</p>
    <p v-else-if="loading && !info" class="empty-state">Laddar…</p>
    <form v-else class="pp-form" @submit.prevent="save">
      <div class="staff-info-grid">
        <label>Arbetsbeskrivning och instruktioner
          <textarea
            v-model="draft.instructions"
            rows="8"
            maxlength="20000"
            placeholder="Skriv eller klistra in. Tom rad = nytt stycke. Rader som börjar med - eller 1. blir listor."
          />
        </label>
        <div>
          <div class="staff-info-meta" style="margin-bottom: 4px">Så här ser personalen det</div>
          <div class="staff-info-preview">
            <RichText v-if="draft.instructions.trim()" :text="draft.instructions" />
            <span v-else class="staff-info-meta">Ingen text ännu.</span>
          </div>
        </div>
      </div>
      <label class="checkbox-label"><input v-model="draft.published" type="checkbox"> Synlig för inplanerad personal</label>
      <div class="modal-actions">
        <span class="staff-info-meta">{{ updatedText }}</span>
        <div class="spacer" />
        <button type="submit" class="plain primary" :disabled="saving || !dirty">Spara</button>
      </div>
    </form>

    <div class="toolbar" style="margin-top: 14px">
      <h3 class="group-title" style="margin: 0">
        Uppgifter till personal
        <span v-if="staffTasks.length" class="staff-info-meta">({{ doneCount }} av {{ staffTasks.length }} klara)</span>
      </h3>
      <div class="spacer" />
      <button v-if="employeeUsers.length" class="plain primary" @click="newStaffTask">+ Ny uppgift till personal</button>
    </div>
    <p v-if="!employeeUsers.length" class="staff-info-meta">
      Det finns inga personalkonton ännu. En admin skapar dem under fliken Konton.
    </p>
    <div class="task-list">
      <div v-if="!staffTasks.length" class="empty-state">Inga uppgifter till personal.</div>
      <TaskRow
        v-for="t in staffTasks"
        :key="t.id"
        :task="t"
        show-owner
        @toggle="emit('toggleTask', $event)"
        @edit="openTaskModal($event)"
        @delete="emit('deleteTask', $event)"
      />
    </div>
  </div>
</template>
