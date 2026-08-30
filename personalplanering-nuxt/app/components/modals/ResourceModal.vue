<script setup lang="ts">
import { colorForResource } from '~/utils/colors'
import { RESOURCE_PALETTE } from '~/utils/constants'

const { resource: modal } = useModals()
const { resources, loadAll } = useAppData()
const { options: departmentOptions, keys: departmentKeys } = useDepartments()
const { api } = useApi()
const toast = useToast()

const open = computed({
  get: () => modal.value.open,
  set: (v) => {
    modal.value = { ...modal.value, open: v }
  },
})

const editing = computed(() => !!modal.value.resource)
const saving = ref(false)
const deleting = ref(false)

const form = reactive({
  id: '' as number | '',
  name: '',
  type: 'anstalld',
  category: '',
  phone: '',
  color: '#2a78d6',
  active: true,
})

const isEmployee = computed(() => form.type === 'anstalld')
const defaultCategory = () => departmentKeys.value[0] ?? ''

watch(
  () => modal.value.open,
  (isOpen) => {
    if (!isOpen) return
    const r = modal.value.resource
    if (r) {
      Object.assign(form, {
        id: r.id,
        name: r.name,
        type: r.type,
        category: r.category || defaultCategory(),
        phone: r.phone || '',
        color: colorForResource(r),
        active: Boolean(r.active),
      })
    } else {
      Object.assign(form, {
        id: '',
        name: '',
        type: 'anstalld',
        category: defaultCategory(),
        phone: '',
        color: RESOURCE_PALETTE[resources.value.length % RESOURCE_PALETTE.length],
        active: true,
      })
    }
  }
)

async function submit() {
  if (saving.value) return
  saving.value = true
  const payload = {
    name: form.name.trim(),
    type: form.type,
    category: isEmployee.value ? form.category : null,
    phone: form.phone.trim(),
    color: form.color,
    active: form.active,
  }
  try {
    if (form.id) {
      await api('PUT', `/api/resources/${form.id}`, payload)
    } else {
      await api('POST', '/api/resources', payload)
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
  if (!confirm('Ta bort personen?')) return
  deleting.value = true
  try {
    await api('DELETE', `/api/resources/${form.id}`)
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
  <UModal v-model:open="open" :title="editing ? 'Redigera person' : 'Lägg till person'">
    <template #body>
      <form id="resource-form" class="pp-form" @submit.prevent="submit">
        <label>Namn *<input v-model="form.name" required></label>
        <label>Typ *
          <select v-model="form.type">
            <option value="anstalld">Anställd</option>
            <option value="underentreprenor">Underentreprenör</option>
          </select>
        </label>
        <label v-show="isEmployee">Kategori *
          <select v-model="form.category" :required="isEmployee">
            <option v-for="d in departmentOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </label>
        <label>Telefon<input v-model="form.phone"></label>
        <label>Färg på tidslinjen<input v-model="form.color" type="color"></label>
        <label class="checkbox-label"><input v-model="form.active" type="checkbox"> Aktiv</label>
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
