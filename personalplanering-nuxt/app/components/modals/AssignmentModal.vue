<script setup lang="ts">
import { activeProjectsForSelect } from '~/utils/analytics'

const { assignment: modal, openProjectModal } = useModals()
const { resources, projects, loadAll } = useAppData()
const { api } = useApi()
const toast = useToast()

const open = computed({
  get: () => modal.value.open,
  set: (v) => {
    modal.value = { ...modal.value, open: v }
  },
})

const editing = computed(() => !!modal.value.assignment)
const saving = ref(false)
const deleting = ref(false)

const form = reactive({
  id: '' as number | '',
  resource_id: '' as number | '',
  project_id: '' as number | '' | '__new__',
  start_date: '',
  end_date: '',
  note: '',
})

let prevProjectId: number | '' = ''

const projectOptions = computed(() =>
  activeProjectsForSelect(projects.value, modal.value.assignment?.project_id ?? null)
)

watch(
  () => modal.value.open,
  (isOpen) => {
    if (!isOpen) return
    const a = modal.value.assignment
    if (a) {
      Object.assign(form, {
        id: a.id,
        resource_id: a.resource_id,
        project_id: a.project_id,
        start_date: a.start_date,
        end_date: a.end_date,
        note: a.note || '',
      })
    } else {
      Object.assign(form, {
        id: '',
        resource_id: modal.value.resourceId ?? (resources.value[0]?.id ?? ''),
        project_id: '',
        start_date: modal.value.date || '',
        end_date: modal.value.date || '',
        note: '',
      })
    }
    prevProjectId = typeof form.project_id === 'number' ? form.project_id : ''
  }
)

function onProjectChange() {
  if (form.project_id !== '__new__') {
    prevProjectId = typeof form.project_id === 'number' ? form.project_id : ''
    return
  }
  form.project_id = prevProjectId
  openProjectModal(null, {
    onCreated: (project) => {
      form.project_id = project.id
      prevProjectId = project.id
      toast.add({ title: `Projekt ${project.project_number} skapat och valt` })
    },
  })
}

async function submit() {
  if (saving.value) return
  saving.value = true
  const payload = {
    resource_id: Number(form.resource_id),
    project_id: Number(form.project_id),
    start_date: form.start_date,
    end_date: form.end_date,
    note: form.note.trim(),
  }
  try {
    if (form.id) {
      await api('PUT', `/api/assignments/${form.id}`, payload)
    } else {
      await api('POST', '/api/assignments', payload)
    }
    open.value = false
    await loadAll()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!form.id || deleting.value) return
  if (!confirm('Ta bort bokningen?')) return
  deleting.value = true
  try {
    await api('DELETE', `/api/assignments/${form.id}`)
    open.value = false
    await loadAll()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="editing ? 'Redigera bokning' : 'Boka personal på projekt'">
    <template #body>
      <form id="assignment-form" class="pp-form" @submit.prevent="submit">
        <label>Person *
          <select v-model="form.resource_id" required>
            <option v-for="r in resources" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </label>
        <label>Projekt *
          <select v-model="form.project_id" required @change="onProjectChange">
            <option value="" disabled>Välj projekt…</option>
            <option v-for="p in projectOptions" :key="p.id" :value="p.id">
              {{ p.project_number }} – {{ p.name }}
            </option>
            <option value="__new__">+ Skapa nytt projekt</option>
          </select>
        </label>
        <div class="row-2">
          <label>Från *<input v-model="form.start_date" type="date" required></label>
          <label>Till *<input v-model="form.end_date" type="date" required></label>
        </div>
        <label>Anteckning<input v-model="form.note"></label>
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
