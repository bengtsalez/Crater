<script setup lang="ts">
import { RESOURCE_PALETTE } from '~/utils/constants'

const { api } = useApi()
const { resources, loadAll } = useAppData()
const { options: departmentOptions, keys: departmentKeys, labelFor: departmentLabel } = useDepartments()
const toast = useToast()

const blank = () => ({
  name: '',
  type: 'anstalld' as 'anstalld' | 'underentreprenor',
  category: departmentKeys.value[0] ?? '',
  phone: '',
  color: RESOURCE_PALETTE[resources.value.length % RESOURCE_PALETTE.length]!,
  active: true,
})

const form = reactive(blank())
const adding = ref(false)

const isEmployee = computed(() => form.type === 'anstalld')

async function add() {
  if (!form.name.trim() || adding.value) return
  if (isEmployee.value && !form.category) {
    toast.add({ title: 'Välj en avdelning.', color: 'error' })
    return
  }
  adding.value = true
  try {
    await api('POST', '/api/resources', {
      name: form.name.trim(),
      type: form.type,
      category: isEmployee.value ? form.category : null,
      phone: form.phone.trim(),
      color: form.color,
      active: form.active,
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
    await api('DELETE', `/api/resources/${id}`)
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
    <h2>Personal</h2>
    <p class="ob-step-lead">Lägg till anställda och underentreprenörer. Du kan hoppa över och göra det senare.</p>

    <ul v-if="resources.length" class="ob-list">
      <li v-for="r in resources" :key="r.id" class="ob-list-row">
        <span class="ob-swatch" :style="{ background: r.color || '#ccc' }" />
        <span class="ob-grow">{{ r.name }}</span>
        <span class="ob-muted">
          {{ r.type === 'anstalld' ? departmentLabel(r.category) : 'Underentreprenör' }}
        </span>
        <button type="button" class="plain danger" @click="remove(r.id)">Ta bort</button>
      </li>
    </ul>

    <form class="pp-form ob-add-form" @submit.prevent="add">
      <label>Namn *<input v-model="form.name" required></label>
      <label>Typ
        <select v-model="form.type">
          <option value="anstalld">Anställd</option>
          <option value="underentreprenor">Underentreprenör</option>
        </select>
      </label>
      <label v-show="isEmployee">Avdelning
        <select v-model="form.category">
          <option v-for="d in departmentOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
        </select>
      </label>
      <div class="row-2">
        <label>Telefon<input v-model="form.phone"></label>
        <label>Färg<input v-model="form.color" type="color"></label>
      </div>
      <label class="checkbox-label"><input v-model="form.active" type="checkbox"> Aktiv</label>
      <div class="modal-actions">
        <div class="spacer" />
        <button type="submit" class="plain primary" :disabled="adding || !form.name.trim()">Lägg till</button>
      </div>
    </form>
  </div>
</template>
