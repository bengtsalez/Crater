<script setup lang="ts">
import type { EmployeeJob, Me } from '~/types'
import { periodRange, splitJobs, weekLabel, type JobPeriod } from '~/utils/employeeJobs'

definePageMeta({ layout: 'employee' })

const me = useState<Me | null>('emp:me', () => null)
const { jobs, today, loaded, loadJobs, startPolling, stopPolling } = useEmployeeData()
const { api } = useApi()

const error = ref('')
const noResource = ref('')
const pending = ref(true)

// "Idag" bygger alltid på standardlistan (idag och framåt). Periodvalet styr
// bara "Kommande" – för en vald vecka/intervall hämtas en egen lista.
const period = ref<JobPeriod>('upcoming')
const customFrom = ref('')
const customTo = ref('')
const rangeJobs = ref<EmployeeJob[] | null>(null)
const rangeLoading = ref(false)

const range = computed(() =>
  today.value ? periodRange(period.value, today.value, { from: customFrom.value, to: customTo.value }) : null
)

const split = computed(() => splitJobs(jobs.value, today.value))
const upcomingList = computed(() => {
  if (period.value === 'upcoming') return split.value.upcoming
  return rangeJobs.value ?? []
})

const periodOptions: { value: JobPeriod; label: string }[] = [
  { value: 'upcoming', label: 'Kommande' },
  { value: 'this_week', label: 'Denna vecka' },
  { value: 'next_week', label: 'Nästa vecka' },
  { value: 'custom', label: 'Välj period' },
]

const upcomingTitle = computed(() => {
  if (period.value === 'upcoming') return 'Kommande arbeten'
  if (!range.value) return 'Välj period'
  if (period.value === 'custom') return `Arbeten ${range.value.from} – ${range.value.to}`
  return `Arbeten ${weekLabel(range.value)}`
})

function handleError(err: unknown) {
  const e = err as ApiError
  if (e?.code === 'no_resource') noResource.value = e.message
  else error.value = e?.message || 'Kunde inte hämta dina arbeten.'
}

async function loadRange() {
  if (!range.value) {
    rangeJobs.value = null
    return
  }
  rangeLoading.value = true
  try {
    const res = await api<{ jobs: EmployeeJob[] }>(
      'GET',
      `/api/employee/jobs?from=${range.value.from}&to=${range.value.to}`
    )
    rangeJobs.value = res.jobs
  } catch (err) {
    handleError(err)
  } finally {
    rangeLoading.value = false
  }
}

async function refresh() {
  await loadJobs()
  if (period.value !== 'upcoming') await loadRange()
  error.value = ''
}

const poll = () => refresh().catch(handleError)

watch(range, (r, prev) => {
  if (JSON.stringify(r) !== JSON.stringify(prev) && period.value !== 'upcoming') loadRange()
})

onMounted(async () => {
  // Ingen resurskoppling → visa beskedet direkt utan att fråga efter arbetsdata.
  if (me.value && !me.value.resource) {
    noResource.value = 'Ditt konto är inte kopplat till någon personalresurs. Kontakta din arbetsledare.'
    pending.value = false
    return
  }
  try {
    await loadJobs()
    startPolling(poll)
  } catch (err) {
    handleError(err)
  } finally {
    pending.value = false
  }
})
onUnmounted(() => stopPolling(poll))
</script>

<template>
  <section class="emp-page">
    <EmployeeNoAccess v-if="noResource" :message="noResource" />
    <template v-else>
      <h1 class="emp-h1">Mina arbeten</h1>
      <p v-if="me?.resource" class="emp-sub">Hej {{ me.resource.name }}!</p>

      <p v-if="error" class="emp-error" role="alert">
        {{ error }}
        <button class="plain" @click="error = ''; refresh().catch(handleError)">Försök igen</button>
      </p>
      <p v-if="pending && !loaded" class="empty-state">Laddar dina arbeten…</p>

      <template v-else-if="loaded">
        <h2 class="emp-h2">Idag</h2>
        <div class="emp-list">
          <p v-if="!split.today.length" class="emp-empty">Inga arbeten inplanerade idag.</p>
          <EmployeeJobCard v-for="j in split.today" :key="j.assignment_id" :job="j" />
        </div>

        <div class="emp-period" role="group" aria-label="Välj period">
          <button
            v-for="o in periodOptions"
            :key="o.value"
            class="emp-seg"
            :class="{ active: period === o.value }"
            :aria-pressed="period === o.value"
            @click="period = o.value"
          >
            {{ o.label }}
          </button>
        </div>
        <div v-if="period === 'custom'" class="emp-range pp-form">
          <label>Från<UiDateField v-model="customFrom" /></label>
          <label>Till<UiDateField v-model="customTo" /></label>
        </div>

        <h2 class="emp-h2">{{ upcomingTitle }}</h2>
        <div class="emp-list">
          <p v-if="rangeLoading" class="empty-state">Laddar…</p>
          <p v-else-if="period === 'custom' && !range" class="emp-empty">Välj från- och till-datum.</p>
          <p v-else-if="!upcomingList.length" class="emp-empty">
            {{ period === 'upcoming' ? 'Du har inga kommande arbeten inplanerade.' : 'Inga arbeten under perioden.' }}
          </p>
          <EmployeeJobCard v-for="j in upcomingList" :key="j.assignment_id" :job="j" />
        </div>
      </template>
    </template>
  </section>
</template>
