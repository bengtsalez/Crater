<script setup lang="ts">
import type { Project } from '~/types'

const { project: modal } = useModals()
const { users, loadAll } = useAppData()
const { options: departmentOptions } = useDepartments()
const { api } = useApi()
const toast = useToast()
const isMobile = useIsMobile()

const open = computed({
  get: () => modal.value.open,
  set: (v) => {
    modal.value = { ...modal.value, open: v }
  },
})

const editing = computed(() => !!modal.value.project)
const saving = ref(false)
const deleting = ref(false)

const form = reactive({
  id: '' as number | '',
  project_number: '',
  name: '',
  client: '',
  category: '',
  project_manager_user_id: '' as number | '',
  sum: '' as number | '',
  start_date: '',
  end_date: '',
  status_override: '',
  notes: '',
})

watch(
  () => modal.value.open,
  async (isOpen) => {
    if (!isOpen) return
    const p = modal.value.project
    if (p) {
      Object.assign(form, {
        id: p.id,
        project_number: p.project_number,
        name: p.name,
        client: p.client || '',
        category: p.category || '',
        project_manager_user_id: p.project_manager_user_id || '',
        sum: p.sum ?? '',
        start_date: p.start_date || '',
        end_date: p.end_date || '',
        status_override: p.status_override || '',
        notes: p.notes || '',
      })
    } else {
      Object.assign(form, {
        id: '',
        project_number: '…',
        name: '',
        client: '',
        category: '',
        project_manager_user_id: '',
        sum: '',
        start_date: '',
        end_date: '',
        status_override: '',
        notes: '',
      })
      try {
        const { next } = await api<{ next: string }>('GET', '/api/projects/next-number')
        form.project_number = next
      } catch {
        form.project_number = ''
      }
    }
  }
)

async function submit() {
  if (saving.value) return
  saving.value = true
  const payload = {
    project_number: form.project_number.trim(),
    name: form.name.trim(),
    client: form.client.trim(),
    category: form.category || null,
    project_manager_user_id: form.project_manager_user_id ? Number(form.project_manager_user_id) : null,
    sum: form.sum === '' ? '' : Number(form.sum),
    start_date: form.start_date,
    end_date: form.end_date,
    status_override: form.status_override || null,
    notes: form.notes.trim(),
  }
  try {
    let created: Project | null = null
    if (form.id) {
      await api('PUT', `/api/projects/${form.id}`, payload)
    } else {
      created = await api<Project>('POST', '/api/projects', payload)
    }
    open.value = false
    await loadAll()
    if (created && modal.value.onCreated) modal.value.onCreated(created)
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!form.id || deleting.value) return
  if (!confirm('Ta bort projektet?')) return
  deleting.value = true
  try {
    await api('DELETE', `/api/projects/${form.id}`)
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
  <UModal v-model:open="open" :fullscreen="isMobile" :title="editing ? 'Redigera projekt' : 'Nytt projekt'">
    <template #body>
      <form id="project-form" class="pp-form" @submit.prevent="submit">
        <label>Projektnummer
          <input v-model="form.project_number" required :readonly="!editing">
        </label>
        <label>Namn *<input v-model="form.name" required></label>
        <label>Kund<input v-model="form.client"></label>
        <label>Kategori
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
        <label>Summa (kr)<input v-model="form.sum" type="number" step="1"></label>
        <div class="row-2">
          <label>Byggstart<input v-model="form.start_date" type="date"></label>
          <label>Byggslut<input v-model="form.end_date" type="date"></label>
        </div>
        <label>Status
          <select v-model="form.status_override">
            <option value="">Automatiskt (styrs av tidslinjen)</option>
            <option value="aktiv">Tvinga: Aktiv</option>
            <option value="planerad">Tvinga: Planerad</option>
            <option value="avslutad">Tvinga: Avslutad</option>
          </select>
          <span class="hint">
            Automatiskt: aktiv tills projektet bokas in, planerad när det ligger i
            tidslinjen, avslutad när sista bokningen passerat. En tvingad status
            gäller tills projektets bokningar ändras.
          </span>
        </label>
        <label>Anteckningar<textarea v-model="form.notes" rows="2" /></label>
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
