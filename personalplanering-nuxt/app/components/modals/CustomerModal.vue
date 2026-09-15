<script setup lang="ts">
import type { Customer } from '~/types'

const { customer: modal } = useModals()
const { currentUser, loadAll } = useAppData()
const { api } = useApi()
const toast = useToast()
const isMobile = useIsMobile()

const open = computed({
  get: () => modal.value.open,
  set: (v) => {
    modal.value = { ...modal.value, open: v }
  },
})

const editing = computed(() => !!modal.value.customer)
const canDelete = computed(() => editing.value && currentUser.value?.role === 'admin')
const saving = ref(false)
const deleting = ref(false)

const form = reactive({
  id: '' as number | '',
  name: '',
  customer_type: '',
  organization_number: '',
  contact_person: '',
  phone: '',
  mobile: '',
  email: '',
  address: '',
  postal_code: '',
  city: '',
  billing_address: '',
  billing_postal_code: '',
  billing_city: '',
  billing_email: '',
  invoice_reference: '',
  notes: '',
})

function fromCustomer(c: Customer | null) {
  Object.assign(form, {
    id: c?.id ?? '',
    name: c?.name ?? '',
    customer_type: c?.customer_type ?? '',
    organization_number: c?.organization_number ?? '',
    contact_person: c?.contact_person ?? '',
    phone: c?.phone ?? '',
    mobile: c?.mobile ?? '',
    email: c?.email ?? '',
    address: c?.address ?? '',
    postal_code: c?.postal_code ?? '',
    city: c?.city ?? '',
    billing_address: c?.billing_address ?? '',
    billing_postal_code: c?.billing_postal_code ?? '',
    billing_city: c?.billing_city ?? '',
    billing_email: c?.billing_email ?? '',
    invoice_reference: c?.invoice_reference ?? '',
    notes: c?.notes ?? '',
  })
}

watch(
  () => modal.value.open,
  (isOpen) => {
    if (isOpen) fromCustomer(modal.value.customer)
  }
)

async function submit() {
  if (saving.value) return
  saving.value = true
  const payload = {
    name: form.name.trim(),
    customer_type: form.customer_type || null,
    organization_number: form.organization_number.trim() || null,
    contact_person: form.contact_person.trim() || null,
    phone: form.phone.trim() || null,
    mobile: form.mobile.trim() || null,
    email: form.email.trim() || null,
    address: form.address.trim() || null,
    postal_code: form.postal_code.trim() || null,
    city: form.city.trim() || null,
    billing_address: form.billing_address.trim() || null,
    billing_postal_code: form.billing_postal_code.trim() || null,
    billing_city: form.billing_city.trim() || null,
    billing_email: form.billing_email.trim() || null,
    invoice_reference: form.invoice_reference.trim() || null,
    notes: form.notes.trim() || null,
  }
  try {
    if (form.id) {
      await api('PUT', `/api/customers/${form.id}`, payload)
    } else {
      await api('POST', '/api/customers', payload)
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
  if (!confirm('Ta bort kunden permanent?')) return
  deleting.value = true
  try {
    await api('DELETE', `/api/customers/${form.id}`)
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
  <UModal
    v-model:open="open"
    :fullscreen="isMobile"
    :title="editing ? 'Redigera kund' : 'Ny kund'"
    :ui="{ overlay: 'z-[100]', content: 'z-[100]' }"
  >
    <template #body>
      <form id="customer-form" class="pp-form" @submit.prevent="submit">
        <label>Namn *<input v-model="form.name" required></label>
        <label>Typ
          <select v-model="form.customer_type">
            <option value="">Ingen vald</option>
            <option value="privat">Privatperson</option>
            <option value="foretag">Företag</option>
          </select>
        </label>
        <label>Org.nummer<input v-model="form.organization_number"></label>

        <h3 class="group-title">Kontakt</h3>
        <label>Kontaktperson<input v-model="form.contact_person"></label>
        <div class="row-2">
          <label>Telefon<input v-model="form.phone"></label>
          <label>Mobil<input v-model="form.mobile"></label>
        </div>
        <label>E-post<input v-model="form.email" type="email"></label>
        <label>Adress<input v-model="form.address"></label>
        <div class="row-2">
          <label>Postnummer<input v-model="form.postal_code"></label>
          <label>Ort<input v-model="form.city"></label>
        </div>

        <h3 class="group-title">Fakturering</h3>
        <label>Fakturaadress<input v-model="form.billing_address"></label>
        <div class="row-2">
          <label>Postnummer<input v-model="form.billing_postal_code"></label>
          <label>Ort<input v-model="form.billing_city"></label>
        </div>
        <label>Faktura-e-post<input v-model="form.billing_email" type="email"></label>
        <label>Referens<input v-model="form.invoice_reference"></label>

        <h3 class="group-title">Anteckningar</h3>
        <label>Anteckningar<textarea v-model="form.notes" rows="2" /></label>

        <div class="modal-actions">
          <button v-if="canDelete" type="button" class="plain danger" :disabled="deleting" @click="remove">Ta bort</button>
          <div class="spacer" />
          <button type="button" class="plain ghost" @click="open = false">Avbryt</button>
          <button type="submit" class="plain primary" :disabled="saving">Spara</button>
        </div>
      </form>
    </template>
  </UModal>
</template>
