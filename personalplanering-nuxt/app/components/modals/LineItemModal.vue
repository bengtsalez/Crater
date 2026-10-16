<script setup lang="ts">
const { lineItem: modal } = useModals()
const { refresh } = useProjectDetail()
const { refresh: refreshActivity } = useProjectActivity()
const { api } = useApi()
const toast = useToast()
const isMobile = useIsMobile()

const open = computed({
  get: () => modal.value.open,
  set: (v) => {
    modal.value = { ...modal.value, open: v }
  },
})

const editing = computed(() => !!modal.value.item)
const label = computed(() => (modal.value.type === 'ata' ? 'ÄTA' : 'utgift'))
const saving = ref(false)
const deleting = ref(false)

const form = reactive({
  id: '' as number | '',
  description: '',
  amount: '' as number | '',
  date: '',
  notes: '',
  ata_status: 'utkast' as 'utkast' | 'skickad' | 'godkand' | 'avbojd',
})

watch(
  () => modal.value.open,
  (isOpen) => {
    if (!isOpen) return
    const it = modal.value.item
    if (it) {
      Object.assign(form, {
        id: it.id,
        description: it.description,
        amount: it.amount,
        date: it.date || '',
        notes: it.notes || '',
        ata_status: it.ata_status || 'utkast',
      })
    } else {
      Object.assign(form, { id: '', description: '', amount: '', date: '', notes: '', ata_status: 'utkast' })
    }
  }
)

async function submit() {
  if (saving.value) return
  saving.value = true
  const payload = {
    project_id: Number(modal.value.projectId),
    type: modal.value.type,
    description: form.description.trim(),
    amount: Number(form.amount),
    date: form.date,
    notes: form.notes.trim(),
    ...(modal.value.type === 'ata' ? { ata_status: form.ata_status } : {}),
  }
  try {
    if (form.id) {
      await api('PUT', `/api/line-items/${form.id}`, payload)
    } else {
      await api('POST', '/api/line-items', payload)
    }
    open.value = false
    await refresh()
    await refreshActivity()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!form.id || deleting.value) return
  if (!confirm('Ta bort raden?')) return
  deleting.value = true
  try {
    await api('DELETE', `/api/line-items/${form.id}`)
    open.value = false
    await refresh()
    await refreshActivity()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :fullscreen="isMobile"
    :title="editing ? `Redigera ${label}` : `Ny ${label}`"
  >
    <template #body>
      <form id="line-item-form" class="pp-form" @submit.prevent="submit">
        <label>Beskrivning *<input v-model="form.description" required></label>
        <label>Belopp (kr) *<input v-model="form.amount" type="number" step="1" required></label>
        <label>Datum<UiDateField v-model="form.date" /></label>
        <label v-if="modal.type === 'ata'">Status
          <select v-model="form.ata_status">
            <option value="utkast">Utkast</option>
            <option value="skickad">Skickad till kund</option>
            <option value="godkand">Godkänd av kund</option>
            <option value="avbojd">Avböjd</option>
          </select>
          <span class="hint">Endast godkända ÄTA kan hämtas till fakturering.</span>
        </label>
        <label>Anteckning<textarea v-model="form.notes" rows="2" /></label>
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
