<script setup lang="ts">
import type { Project } from '~/types'
import { activeProjectsForSelect } from '~/utils/analytics'
import { BILLING_TYPE_LABELS } from '~/utils/projects'

const { quickJob: modal, openAssignmentModal } = useModals()
const { users, projects, loadAll } = useAppData()
const { options: departmentOptions } = useDepartments()
const { api } = useApi()
const toast = useToast()
const isMobile = useIsMobile()

const open = computed({
  get: () => modal.value.open,
  set: (v) => {
    modal.value = { ...modal.value, open: v }
    if (!v) createdJob.value = null
  },
})

const saving = ref(false)
const createdJob = ref<Project | null>(null)

const form = reactive({
  billing_type: 'billable' as 'billable' | 'warranty' | 'internal',
  customer_id: null as number | null,
  customer_name: '',
  name: '',
  category: '',
  project_manager_user_id: '' as number | '',
  source_project_id: null as number | null,
  notes: '',
})

const relatedProjectOptions = computed(() =>
  activeProjectsForSelect(
    projects.value.filter((p) => p.work_type === 'project'),
    form.source_project_id
  ).map((p) => ({ id: p.id, label: `${p.project_number} – ${p.name}` }))
)

watch(
  () => modal.value.open,
  (isOpen) => {
    if (!isOpen) return
    createdJob.value = null
    Object.assign(form, {
      billing_type: 'billable',
      customer_id: null,
      customer_name: '',
      name: '',
      category: '',
      project_manager_user_id: '',
      source_project_id: null,
      notes: '',
    })
  }
)

async function submit() {
  if (saving.value) return
  saving.value = true
  const payload = {
    work_type: 'small_job',
    billing_type: form.billing_type,
    customer_id: form.customer_id,
    customer_name: form.customer_name.trim(),
    name: form.name.trim(),
    category: form.category || null,
    project_manager_user_id: form.project_manager_user_id ? Number(form.project_manager_user_id) : null,
    source_project_id: form.source_project_id,
    notes: form.notes.trim(),
  }
  try {
    const created = await api<Project>('POST', '/api/projects', payload)
    await loadAll()
    if (modal.value.onCreated) {
      modal.value.onCreated(created)
      open.value = false
    } else {
      createdJob.value = created
    }
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}

function planNow() {
  if (!createdJob.value) return
  const job = createdJob.value
  open.value = false
  openAssignmentModal({ projectId: job.id })
}
</script>

<template>
  <UModal v-model:open="open" :fullscreen="isMobile" title="Nytt ströjobb">
    <template #body>
      <div v-if="createdJob" class="pp-form">
        <p>Ströjobb <strong>{{ createdJob.project_number }}</strong> skapat.</p>
        <div class="modal-actions">
          <div class="spacer" />
          <button type="button" class="plain ghost" @click="open = false">Stäng</button>
          <button type="button" class="plain primary" @click="planNow">Planera nu</button>
        </div>
      </div>
      <form v-else id="quick-job-form" class="pp-form" @submit.prevent="submit">
        <label>Typ
          <select v-model="form.billing_type">
            <option v-for="(label, key) in BILLING_TYPE_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label>Kund
          <UiCustomerPicker v-model:customer-id="form.customer_id" v-model:customer-name="form.customer_name" />
        </label>
        <label>Arbete *<input v-model="form.name" required></label>
        <label>Avdelning
          <select v-model="form.category">
            <option value="">Ingen vald</option>
            <option v-for="d in departmentOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </label>
        <label>Projektledare
          <select v-model="form.project_manager_user_id">
            <option value="">Ingen vald</option>
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.username }}</option>
          </select>
        </label>
        <label>Relaterat projekt
          <UInputMenu
            v-model="form.source_project_id"
            :items="relatedProjectOptions"
            value-key="id"
            label-key="label"
            placeholder="Sök tidigare projekt…"
            :clear="true"
          />
        </label>
        <label>Anteckning<textarea v-model="form.notes" rows="2" /></label>
        <div class="modal-actions">
          <div class="spacer" />
          <button type="button" class="plain ghost" @click="open = false">Avbryt</button>
          <button type="submit" class="plain primary" :disabled="saving">Spara</button>
        </div>
      </form>
    </template>
  </UModal>
</template>
