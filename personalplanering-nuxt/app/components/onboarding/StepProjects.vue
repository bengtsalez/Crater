<script setup lang="ts">
const { api } = useApi()
const { projects, users, loadAll } = useAppData()
const { options: departmentOptions, labelFor: departmentLabel } = useDepartments()
const toast = useToast()

const blank = () => ({
  name: '',
  client: '',
  category: '',
  project_manager_user_id: '' as number | '',
  sum: '' as number | '',
  start_date: '',
  end_date: '',
})

const form = reactive(blank())
const adding = ref(false)

async function add() {
  if (!form.name.trim() || adding.value) return
  adding.value = true
  try {
    await api('POST', '/api/projects', {
      name: form.name.trim(),
      client: form.client.trim(),
      category: form.category || null,
      project_manager_user_id: form.project_manager_user_id
        ? Number(form.project_manager_user_id)
        : null,
      sum: form.sum === '' ? '' : Number(form.sum),
      start_date: form.start_date,
      end_date: form.end_date,
    })
    await loadAll()
    Object.assign(form, blank())
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    adding.value = false
  }
}

async function remove(id: number) {
  try {
    await api('DELETE', `/api/projects/${id}`)
    await loadAll()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
async function save(): Promise<boolean> {
  return true
}
defineExpose({ save })
</script>

<template>
  <div class="ob-step">
    <h2>Projekt</h2>
    <p class="ob-step-lead">Lägg in pågående projekt nu, eller hoppa över och skapa dem senare.</p>

    <ul v-if="projects.length" class="ob-list">
      <li v-for="p in projects" :key="p.id" class="ob-list-row">
        <span class="ob-muted">{{ p.project_number }}</span>
        <span class="ob-grow">{{ p.name }}</span>
        <span class="ob-muted">{{ departmentLabel(p.category) }}</span>
        <button type="button" class="plain danger" @click="remove(p.id)">Ta bort</button>
      </li>
    </ul>

    <form class="pp-form ob-add-form" @submit.prevent="add">
      <label>Namn *<input v-model="form.name" required></label>
      <label>Kund<input v-model="form.client"></label>
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
      <label>Summa (kr)<input v-model="form.sum" type="number" step="1"></label>
      <div class="row-2">
        <label>Byggstart<input v-model="form.start_date" type="date"></label>
        <label>Byggslut<input v-model="form.end_date" type="date"></label>
      </div>
      <div class="modal-actions">
        <div class="spacer" />
        <button type="submit" class="plain primary" :disabled="adding || !form.name.trim()">Lägg till</button>
      </div>
    </form>
  </div>
</template>
