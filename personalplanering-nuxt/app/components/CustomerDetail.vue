<script setup lang="ts">
import { formatSum } from '~/utils/format'
import { STATUS_LABELS } from '~/utils/constants'

const { customers, projects } = useAppData()
const { labelFor: departmentLabel } = useDepartments()
const { customerDetailId, customerDetailBackLabel, closeCustomerDetail, openProjectDetail } = useUiState()
const { openCustomerModal } = useModals()

const customer = computed(() => customers.value.find((c) => c.id === customerDetailId.value) || null)

watch(customer, (c) => {
  if (customerDetailId.value && !c) closeCustomerDetail()
})

const linkedProjects = computed(() =>
  customer.value
    ? [...projects.value]
        .filter((p) => p.customer_id === customer.value!.id)
        .sort((a, b) => a.project_number.localeCompare(b.project_number, 'sv'))
    : []
)
const activeProjects = computed(() => linkedProjects.value.filter((p) => p.status !== 'avslutad'))
const previousProjects = computed(() => linkedProjects.value.filter((p) => p.status === 'avslutad'))

const totalCount = computed(() => linkedProjects.value.length)
const activeCount = computed(() => activeProjects.value.length)
const totalSum = computed(() => linkedProjects.value.reduce((sum, p) => sum + (p.sum || 0), 0))
</script>

<template>
  <section v-if="customer">
    <div class="toolbar">
      <button class="plain ghost" @click="closeCustomerDetail()">{{ customerDetailBackLabel }}</button>
      <div class="spacer" />
      <button class="plain primary" @click="openCustomerModal(customer)">Redigera kund</button>
    </div>

    <div class="pd-header">
      <h2 class="pd-title">{{ customer.name }}</h2>
    </div>
    <div class="pd-meta">
      <span>Org.nr: {{ customer.organization_number || '–' }}</span>
      <span>Kontaktperson: {{ customer.contact_person || '–' }}</span>
      <span>Telefon: {{ customer.phone || '–' }}</span>
      <span>Mobil: {{ customer.mobile || '–' }}</span>
      <span>E-post: {{ customer.email || '–' }}</span>
      <span>Adress: {{ customer.address || '–' }}<template v-if="customer.postal_code || customer.city">, {{ customer.postal_code }} {{ customer.city }}</template></span>
    </div>
    <div class="pd-meta">
      <span>Fakturaadress: {{ customer.billing_address || '–' }}<template v-if="customer.billing_postal_code || customer.billing_city">, {{ customer.billing_postal_code }} {{ customer.billing_city }}</template></span>
      <span>Faktura-e-post: {{ customer.billing_email || '–' }}</span>
      <span>Referens: {{ customer.invoice_reference || '–' }}</span>
    </div>
    <p v-if="customer.notes" class="hint">{{ customer.notes }}</p>

    <div class="ms-overview">
      <div class="ms-stat"><div class="ms-stat-value">{{ totalCount }}</div><div class="ms-stat-label">Projekt totalt</div></div>
      <div class="ms-stat"><div class="ms-stat-value">{{ activeCount }}</div><div class="ms-stat-label">Aktiva projekt</div></div>
      <div class="ms-stat"><div class="ms-stat-value">{{ formatSum(totalSum) }}</div><div class="ms-stat-label">Summa totalt</div></div>
    </div>

    <h3 class="group-title">Pågående projekt</h3>
    <table class="data-table">
      <thead><tr><th>Projektnr</th><th>Namn</th><th>Kategori</th><th>Status</th><th>År</th><th>Summa</th></tr></thead>
      <tbody>
        <tr v-if="!activeProjects.length"><td colspan="6" class="empty-state">Inga pågående projekt.</td></tr>
        <tr v-for="p in activeProjects" :key="p.id" class="clickable" @click="openProjectDetail(p.id)">
          <td data-label="Projektnr">{{ p.project_number }}</td>
          <td data-label="Namn">{{ p.name }}</td>
          <td data-label="Kategori">{{ departmentLabel(p.category) }}</td>
          <td data-label="Status"><span class="badge" :class="p.status">{{ STATUS_LABELS[p.status] || p.status }}</span></td>
          <td data-label="År">{{ p.start_date?.slice(0, 4) || '–' }}</td>
          <td data-label="Summa">{{ formatSum(p.sum) }}</td>
        </tr>
      </tbody>
    </table>

    <h3 class="group-title">Tidigare projekt</h3>
    <table class="data-table">
      <thead><tr><th>Projektnr</th><th>Namn</th><th>Kategori</th><th>Status</th><th>År</th><th>Summa</th></tr></thead>
      <tbody>
        <tr v-if="!previousProjects.length"><td colspan="6" class="empty-state">Inga tidigare projekt.</td></tr>
        <tr v-for="p in previousProjects" :key="p.id" class="clickable" @click="openProjectDetail(p.id)">
          <td data-label="Projektnr">{{ p.project_number }}</td>
          <td data-label="Namn">{{ p.name }}</td>
          <td data-label="Kategori">{{ departmentLabel(p.category) }}</td>
          <td data-label="Status"><span class="badge" :class="p.status">{{ STATUS_LABELS[p.status] || p.status }}</span></td>
          <td data-label="År">{{ p.start_date?.slice(0, 4) || '–' }}</td>
          <td data-label="Summa">{{ formatSum(p.sum) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
