<script setup lang="ts">
import type { AccountantProjectDetail } from '~/types'
import { workTypeLabel } from '~/utils/accountant'
import { customerAddress, telHref } from '~/utils/employeeJobs'

definePageMeta({ layout: 'accountant' })

// Skrivskyddad detaljvy: projekt, fullständiga kund-/faktureringsuppgifter och ÄTA/utgifter.
const route = useRoute()
const { api } = useApi()

const data = ref<AccountantProjectDetail | null>(null)
const pending = ref(true)
const notFound = ref(false)
const error = ref('')

async function load() {
  pending.value = true
  try {
    data.value = await api<AccountantProjectDetail>('GET', `/api/accountant/projects/${Number(route.params.id)}`)
    error.value = ''
  } catch (err) {
    if ((err as ApiError)?.status === 404) notFound.value = true
    else error.value = (err as Error).message || 'Kunde inte hämta projektet.'
  } finally {
    pending.value = false
  }
}

const c = computed(() => data.value?.customer ?? null)
const address = computed(() => customerAddress(c.value))
const billingAddress = computed(() =>
  c.value
    ? customerAddress({ address: c.value.billing_address, postal_code: c.value.billing_postal_code, city: c.value.billing_city })
    : ''
)
const ata = computed(() => data.value?.line_items.filter((i) => i.type === 'ata') ?? [])
const expenses = computed(() => data.value?.line_items.filter((i) => i.type === 'utgift') ?? [])
const total = (items: { amount: number }[]) => items.reduce((s, i) => s + i.amount, 0)

onMounted(load)
</script>

<template>
  <section class="emp-page">
    <NuxtLink to="/redovisning" class="emp-back">‹ Alla projekt</NuxtLink>

    <p v-if="pending && !data" class="empty-state">Laddar…</p>
    <div v-else-if="notFound" class="emp-notice" role="alert">
      <h2>Projektet finns inte</h2>
      <p>Det kan ha tagits bort.</p>
      <NuxtLink to="/redovisning" class="plain primary emp-btn">Till alla projekt</NuxtLink>
    </div>
    <p v-else-if="error && !data" class="emp-error" role="alert">
      {{ error }}
      <button class="plain" @click="load">Försök igen</button>
    </p>

    <template v-else-if="data">
      <header class="emp-detail-head">
        <span class="emp-card-number">{{ data.project.project_number }}</span>
        <h1 class="emp-h1">{{ data.project.name }}</h1>
        <span class="badge" :class="data.project.status">{{ STATUS_LABELS[data.project.status] || data.project.status }}</span>
      </header>

      <div class="acc-grid">
        <div class="emp-block">
          <h2 class="emp-h2">Projektet</h2>
          <div class="emp-field">
            <div class="emp-label">Typ</div>
            <div class="emp-value">
              {{ workTypeLabel(data.project) }} · {{ BILLING_TYPE_LABELS[data.project.billing_type] || data.project.billing_type }}
            </div>
          </div>
          <div class="emp-field">
            <div class="emp-label">Belopp</div>
            <div class="emp-value">{{ formatSum(data.project.sum) }}</div>
          </div>
          <div class="emp-field">
            <div class="emp-label">Period</div>
            <div class="emp-value">{{ data.project.start_date || '?' }} – {{ data.project.end_date || '?' }}</div>
          </div>
          <div class="emp-field">
            <div class="emp-label">Projektledare</div>
            <div class="emp-value">{{ data.project.project_manager_username || '–' }}</div>
          </div>
          <div class="emp-field">
            <div class="emp-label">Arbetsplatsens adress</div>
            <div class="emp-value">{{ data.project.site_address || '–' }}</div>
          </div>
        </div>

        <div class="emp-block">
          <h2 class="emp-h2">Kund</h2>
          <p v-if="!c" class="emp-empty">Ingen kund angiven.</p>
          <template v-else>
            <div class="emp-field">
              <div class="emp-label">Namn</div>
              <div class="emp-value">{{ c.name || '–' }}<span v-if="c.customer_type" class="emp-muted"> · {{ c.customer_type }}</span></div>
            </div>
            <div class="emp-field">
              <div class="emp-label">Org.nr / personnr</div>
              <div class="emp-value">{{ c.organization_number || '–' }}</div>
            </div>
            <div v-if="c.contact_person" class="emp-field">
              <div class="emp-label">Kontaktperson</div>
              <div class="emp-value">{{ c.contact_person }}</div>
            </div>
            <div v-if="c.email || c.phone || c.mobile" class="emp-field">
              <div class="emp-label">Kontakt</div>
              <div v-if="c.email" class="emp-value"><a :href="`mailto:${c.email}`" class="acc-link">{{ c.email }}</a></div>
              <div v-if="c.phone" class="emp-value"><a :href="telHref(c.phone) || undefined" class="acc-link">{{ c.phone }}</a></div>
              <div v-if="c.mobile" class="emp-value"><a :href="telHref(c.mobile) || undefined" class="acc-link">{{ c.mobile }}</a></div>
            </div>
            <div class="emp-field">
              <div class="emp-label">Adress</div>
              <div class="emp-value">{{ address || '–' }}</div>
            </div>
          </template>
        </div>

        <div v-if="c" class="emp-block">
          <h2 class="emp-h2">Fakturering</h2>
          <div class="emp-field">
            <div class="emp-label">Fakturaadress</div>
            <div class="emp-value">{{ billingAddress || address || '–' }}</div>
            <div v-if="!billingAddress && address" class="emp-muted">Samma som kundens adress</div>
          </div>
          <div class="emp-field">
            <div class="emp-label">Faktura-e-post</div>
            <div class="emp-value">
              <a v-if="c.billing_email" :href="`mailto:${c.billing_email}`" class="acc-link">{{ c.billing_email }}</a>
              <template v-else>–</template>
            </div>
          </div>
          <div class="emp-field">
            <div class="emp-label">Fakturareferens</div>
            <div class="emp-value">{{ c.invoice_reference || '–' }}</div>
          </div>
        </div>
      </div>

      <div class="emp-block">
        <h2 class="emp-h2">ÄTA</h2>
        <p v-if="!ata.length" class="emp-empty">Inga ÄTA-poster.</p>
        <table v-else class="data-table">
          <thead><tr><th>Datum</th><th>Beskrivning</th><th class="acc-num">Belopp</th></tr></thead>
          <tbody>
            <tr v-for="i in ata" :key="i.id">
              <td data-label="Datum">{{ i.date || '–' }}</td>
              <td data-label="Beskrivning">{{ i.description }}</td>
              <td data-label="Belopp" class="acc-num">{{ formatSum(i.amount) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="acc-total"><td colspan="2" data-label="">Summa ÄTA</td><td data-label="Belopp" class="acc-num">{{ formatSum(total(ata)) }}</td></tr>
          </tfoot>
        </table>
      </div>

      <div class="emp-block">
        <h2 class="emp-h2">Utgifter</h2>
        <p v-if="!expenses.length" class="emp-empty">Inga utgifter.</p>
        <table v-else class="data-table">
          <thead><tr><th>Datum</th><th>Beskrivning</th><th class="acc-num">Belopp</th></tr></thead>
          <tbody>
            <tr v-for="i in expenses" :key="i.id">
              <td data-label="Datum">{{ i.date || '–' }}</td>
              <td data-label="Beskrivning">{{ i.description }}</td>
              <td data-label="Belopp" class="acc-num">{{ formatSum(i.amount) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="acc-total"><td colspan="2" data-label="">Summa utgifter</td><td data-label="Belopp" class="acc-num">{{ formatSum(total(expenses)) }}</td></tr>
          </tfoot>
        </table>
      </div>
    </template>
  </section>
</template>
