<script setup lang="ts">
// Företagsuppgifter som visas på faktureringsunderlagen. Endast admin redigerar.
const props = defineProps<{ isAdmin: boolean }>()
const { api } = useApi()
const toast = useToast()
const open = ref(false)
const form = reactive({
  name: '',
  organization_number: '',
  vat_number: '',
  address: '',
  postal_code: '',
  city: '',
  email: '',
  phone: '',
  bankgiro: '',
  f_skatt: false,
})
const saving = ref(false)
const missing = computed(() => !form.organization_number || !form.address)

async function load() {
  try {
    const r = await api<Record<string, unknown>>('GET', '/api/billing/company')
    for (const k of Object.keys(form) as (keyof typeof form)[]) {
      if (k === 'f_skatt') form.f_skatt = !!r.f_skatt
      else form[k] = (r[k] as string) ?? ''
    }
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}
onMounted(load)

async function save() {
  saving.value = true
  try {
    await api('PUT', '/api/billing/company', form)
    toast.add({ title: 'Företagsuppgifterna sparade', color: 'success' })
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="billing-section">
    <button type="button" class="link-button billing-collapse" @click="open = !open">
      {{ open ? '▾' : '▸' }} Företagsuppgifter
      <span v-if="missing" class="bl-invalid">· saknas</span>
    </button>
    <form v-if="open" class="pp-form" @submit.prevent="save">
      <p v-if="!props.isAdmin" class="hint">Endast admin kan ändra.</p>
      <fieldset :disabled="!props.isAdmin" class="billing-fieldset">
        <div class="row-2">
          <label>Org.nr<input v-model="form.organization_number" maxlength="20"></label>
          <label>Momsreg.nr<input v-model="form.vat_number" maxlength="20"></label>
          <label>Bankgiro<input v-model="form.bankgiro" maxlength="20"></label>
        </div>
        <div class="row-2">
          <label>Adress<input v-model="form.address" maxlength="200"></label>
          <label>Postnummer<input v-model="form.postal_code" maxlength="10"></label>
          <label>Ort<input v-model="form.city" maxlength="100"></label>
        </div>
        <div class="row-2">
          <label>E-post<input v-model="form.email" maxlength="200"></label>
          <label>Telefon<input v-model="form.phone" maxlength="50"></label>
          <label class="checkbox-label"><input v-model="form.f_skatt" type="checkbox"> Godkänd för F-skatt</label>
        </div>
        <div v-if="props.isAdmin" class="modal-actions">
          <div class="spacer" />
          <button type="submit" class="plain primary" :disabled="saving">Spara</button>
        </div>
      </fieldset>
    </form>
  </section>
</template>
