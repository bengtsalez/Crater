<script setup lang="ts">
import type { EmployeeJobDetail, EmployeeTask } from '~/types'
import { customerAddress, formatBookingPeriod, mapsUrl, sameAddress, telHref } from '~/utils/employeeJobs'

definePageMeta({ layout: 'employee' })

const route = useRoute()
const { api } = useApi()
const { startPolling, stopPolling } = useEmployeeData()
const toast = useToast()

const projectId = computed(() => Number(route.params.id))
const job = ref<EmployeeJobDetail | null>(null)
const pending = ref(true)
const notFound = ref(false)
const noResource = ref('')
const error = ref('')
const savingTaskId = ref<number | null>(null)

async function load() {
  try {
    job.value = await api<EmployeeJobDetail>('GET', `/api/employee/jobs/${projectId.value}`)
    error.value = ''
    notFound.value = false
  } catch (err) {
    const e = err as ApiError
    job.value = null
    if (e?.status === 404) notFound.value = true
    else if (e?.code === 'no_resource') noResource.value = e.message
    else error.value = e?.message || 'Kunde inte hämta arbetet.'
  } finally {
    pending.value = false
  }
}

onMounted(() => {
  load()
  startPolling(load)
})
onUnmounted(() => stopPolling(load))
watch(projectId, () => {
  pending.value = true
  load()
})

const siteAddress = computed(() => job.value?.project.site_address?.trim() || '')
const custAddress = computed(() => customerAddress(job.value?.customer ?? null))
const customerAddressSameAsSite = computed(() => sameAddress(siteAddress.value, custAddress.value))
const customerPhone = computed(() => job.value?.customer?.mobile || job.value?.customer?.phone || null)
const customerTel = computed(() => telHref(customerPhone.value))
const pmTel = computed(() => telHref(job.value?.project_manager?.phone))
const hasCustomer = computed(() => {
  const c = job.value?.customer
  return !!c && Object.values(c).some(Boolean)
})

const openTasks = computed(() => job.value?.tasks.filter((t) => t.status !== 'avslutad') ?? [])
const doneTasks = computed(() => job.value?.tasks.filter((t) => t.status === 'avslutad') ?? [])

function formatUpdated(iso: string) {
  return new Date(iso).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })
}

async function toggle(t: EmployeeTask) {
  if (savingTaskId.value) return
  savingTaskId.value = t.id
  const status = t.status === 'avslutad' ? 'aktiv' : 'avslutad'
  try {
    const updated = await api<EmployeeTask>('PUT', `/api/employee/tasks/${t.id}`, { status })
    if (job.value) job.value.tasks = job.value.tasks.map((x) => (x.id === t.id ? updated : x))
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
    await load()
  } finally {
    savingTaskId.value = null
  }
}
</script>

<template>
  <section class="emp-page">
    <NuxtLink to="/personal" class="emp-back">‹ Mina arbeten</NuxtLink>

    <EmployeeNoAccess v-if="noResource" :message="noResource" />
    <p v-else-if="pending && !job" class="empty-state">Laddar arbetet…</p>
    <div v-else-if="notFound" class="emp-notice" role="alert">
      <h2>Arbetet kunde inte visas</h2>
      <p>Arbetet finns inte eller är inte längre tilldelat dig.</p>
      <NuxtLink to="/personal" class="plain primary emp-btn">Till mina arbeten</NuxtLink>
    </div>
    <p v-else-if="error && !job" class="emp-error" role="alert">
      {{ error }} <button class="plain" @click="load()">Försök igen</button>
    </p>

    <template v-else-if="job">
      <header class="emp-detail-head">
        <span class="emp-card-number">{{ job.project.project_number }}</span>
        <h1 class="emp-h1">{{ job.project.name }}</h1>
      </header>

      <!-- Arbetet -->
      <div class="emp-block">
        <h2 class="emp-h2">Arbetet</h2>
        <div class="emp-field">
          <div class="emp-label">{{ job.my_bookings.length > 1 ? 'Mina arbetsperioder' : 'Min arbetsperiod' }}</div>
          <div v-for="b in job.my_bookings" :key="b.id" class="emp-value">
            {{ formatBookingPeriod(b.start_date, b.end_date) }}
            <span v-if="b.note" class="emp-muted"> · {{ b.note }}</span>
          </div>
        </div>
        <div class="emp-field">
          <div class="emp-label">Arbetsplatsens adress</div>
          <div v-if="siteAddress" class="emp-value">{{ siteAddress }}</div>
          <div v-else class="emp-value emp-muted">Ingen adress angiven</div>
          <a v-if="siteAddress" :href="mapsUrl(siteAddress)" target="_blank" rel="noopener noreferrer" class="plain emp-btn">
            <UIcon name="i-lucide-map" /> Öppna karta
          </a>
        </div>
        <div v-if="job.project_manager" class="emp-field">
          <div class="emp-label">Projektledare</div>
          <div class="emp-value">{{ job.project_manager.username }}</div>
          <div class="emp-actions">
            <a v-if="pmTel" :href="pmTel" class="plain emp-btn"><UIcon name="i-lucide-phone" /> Ring {{ job.project_manager.phone }}</a>
            <a v-if="job.project_manager.email" :href="`mailto:${job.project_manager.email}`" class="plain emp-btn">
              <UIcon name="i-lucide-mail" /> E-post
            </a>
          </div>
          <div v-if="!pmTel && !job.project_manager.email" class="emp-muted">Inga kontaktuppgifter angivna.</div>
        </div>
      </div>

      <!-- Kunden -->
      <div class="emp-block">
        <h2 class="emp-h2">Kunden</h2>
        <p v-if="!hasCustomer" class="emp-empty">Ingen kund angiven.</p>
        <template v-else>
          <div class="emp-field">
            <div class="emp-label">Kund</div>
            <div class="emp-value">{{ job.customer?.name || '–' }}</div>
          </div>
          <div v-if="job.customer?.contact_person" class="emp-field">
            <div class="emp-label">Kontaktperson</div>
            <div class="emp-value">{{ job.customer.contact_person }}</div>
          </div>
          <div class="emp-field">
            <div class="emp-label">Telefon</div>
            <a v-if="customerTel" :href="customerTel" class="plain primary emp-btn">
              <UIcon name="i-lucide-phone" /> Ring {{ customerPhone }}
            </a>
            <div v-else class="emp-value emp-muted">Inget telefonnummer angivet</div>
          </div>
          <div v-if="custAddress" class="emp-field">
            <div class="emp-label">Kundens adress</div>
            <div v-if="customerAddressSameAsSite" class="emp-value emp-muted">Samma som arbetsplatsen</div>
            <template v-else>
              <div class="emp-value">{{ custAddress }}</div>
              <a :href="mapsUrl(custAddress)" target="_blank" rel="noopener noreferrer" class="plain emp-btn">
                <UIcon name="i-lucide-map" /> Öppna karta
              </a>
            </template>
          </div>
        </template>
      </div>

      <!-- Mina uppgifter -->
      <div class="emp-block">
        <h2 class="emp-h2">Mina uppgifter</h2>
        <p v-if="!job.tasks.length" class="emp-empty">Du har inga uppgifter på det här arbetet.</p>
        <div v-for="t in [...openTasks, ...doneTasks]" :key="t.id" class="emp-task" :class="{ done: t.status === 'avslutad' }">
          <div class="emp-task-main">
            <div class="emp-task-title">{{ t.title }}</div>
            <div class="emp-task-meta">
              <span class="badge" :class="t.status === 'avslutad' ? 'aktiv' : 'planerad'">
                {{ t.status === 'avslutad' ? 'Klar' : 'Att göra' }}
              </span>
              <span v-if="t.due_date">Deadline: {{ t.due_date }}</span>
            </div>
            <RichText v-if="t.notes" :text="t.notes" class="emp-task-notes" />
          </div>
          <button
            class="plain emp-btn"
            :class="{ primary: t.status !== 'avslutad' }"
            :disabled="savingTaskId === t.id"
            @click="toggle(t)"
          >
            {{ t.status === 'avslutad' ? 'Återöppna' : 'Markera klar' }}
          </button>
        </div>
      </div>

      <!-- Arbetsinformation -->
      <div class="emp-block">
        <h2 class="emp-h2">Arbetsinformation</h2>
        <template v-if="job.staff_info">
          <RichText :text="job.staff_info.instructions" />
          <p class="emp-muted emp-updated">
            Uppdaterad {{ formatUpdated(job.staff_info.updated_at) }}<template v-if="job.staff_info.updated_by"> av {{ job.staff_info.updated_by }}</template>
          </p>
        </template>
        <p v-else class="emp-empty">Ingen arbetsinformation ännu.</p>
      </div>
    </template>
  </section>
</template>
