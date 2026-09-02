<script setup lang="ts">
import { activeProjectsForSelect } from '~/utils/analytics'

const { task: modal } = useModals()
const { projects, loadAll } = useAppData()
const { refresh } = useProjectDetail()
const { projectDetailId } = useUiState()
const { api } = useApi()
const toast = useToast()
const isMobile = useIsMobile()

const open = computed({
  get: () => modal.value.open,
  set: (v) => {
    modal.value = { ...modal.value, open: v }
  },
})

const editing = computed(() => !!modal.value.task)
const saving = ref(false)
const deleting = ref(false)

const form = reactive({
  id: '' as number | '',
  title: '',
  project_id: '' as number | '',
  due_date: '',
  notes: '',
  status: 'aktiv',
})

const projectOptions = computed(() =>
  activeProjectsForSelect(projects.value, modal.value.task?.project_id ?? null)
)

watch(
  () => modal.value.open,
  (isOpen) => {
    if (!isOpen) return
    const t = modal.value.task
    if (t) {
      Object.assign(form, {
        id: t.id,
        title: t.title,
        project_id: t.project_id || '',
        due_date: t.due_date || '',
        notes: t.notes || '',
        status: t.status,
      })
    } else {
      Object.assign(form, {
        id: '',
        title: '',
        project_id: modal.value.defaultProjectId || '',
        due_date: '',
        notes: '',
        status: 'aktiv',
      })
    }
  }
)

async function submit() {
  if (saving.value) return
  saving.value = true
  const payload = {
    title: form.title.trim(),
    project_id: form.project_id ? Number(form.project_id) : null,
    due_date: form.due_date,
    notes: form.notes.trim(),
    status: form.status,
  }
  try {
    if (form.id) {
      await api('PUT', `/api/tasks/${form.id}`, payload)
    } else {
      await api('POST', '/api/tasks', payload)
    }
    open.value = false
    await loadAll()
    if (projectDetailId.value) await refresh()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!form.id || deleting.value) return
  if (!confirm('Ta bort uppgiften?')) return
  deleting.value = true
  try {
    await api('DELETE', `/api/tasks/${form.id}`)
    open.value = false
    await loadAll()
    if (projectDetailId.value) await refresh()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :fullscreen="isMobile" :title="editing ? 'Redigera uppgift' : 'Ny uppgift'">
    <template #body>
      <form id="task-form" class="pp-form" @submit.prevent="submit">
        <label>Titel *<input v-model="form.title" required></label>
        <label>Projekt
          <select v-model="form.project_id">
            <option value="">Inget projekt</option>
            <option v-for="p in projectOptions" :key="p.id" :value="p.id">
              {{ p.project_number }} – {{ p.name }}
            </option>
          </select>
        </label>
        <label>Förfallodatum<input v-model="form.due_date" type="date"></label>
        <label>Anteckning<textarea v-model="form.notes" rows="2" /></label>
        <label>Status
          <select v-model="form.status">
            <option value="aktiv">Aktiv</option>
            <option value="avslutad">Avslutad</option>
          </select>
        </label>
        <div class="modal-actions">
          <button v-if="editing" type="button" class="plain danger" :disabled="deleting" @click="remove">Ta bort</button>
          <div class="spacer" />
          <button type="button" class="plain ghost" @click="open = false">Avbryt</button>
          <button type="submit" class="plain primary" :disabled="saving">Spara</button>
        </div>
      </form>
    </template>
  </UModal>
</template>
