<script setup lang="ts">
import {
  filterProjectsByDepartment,
  getUpcomingScheduledProjects,
  getFutureSignedProjects,
  getDelayedStartProjects,
  getActiveTodayProjects,
  getUnstaffedUpcomingProjects,
  projectValueSum,
} from '~/utils/analytics'
import { ANALYTICS_UNSTAFFED_LEAD_DAYS, ANALYTICS_UPCOMING_WINDOW_DAYS } from '~/utils/constants'
import { formatSum } from '~/utils/format'
import type { Project } from '~/types'

const { projects, assignments } = useAppData()
const { options: departmentOptions } = useDepartments()
const { openProjectListModal } = useModals()
const today = useToday()

const department = ref('')
const filtered = computed(() => filterProjectsByDepartment(projects.value, department.value))

interface Card {
  key: string
  label: string
  display: string
  projects: Project[]
  showSum: boolean
  warn?: boolean
}

const cards = computed<Card[]>(() => {
  const a = assignments.value
  const p = filtered.value
  const t = today.value

  const scheduled = getUpcomingScheduledProjects(a, p, t)
  const signed = getFutureSignedProjects(a, p, t)
  const delayed = getDelayedStartProjects(a, p, t)
  const active = getActiveTodayProjects(a, p, t)
  const unstaffed = getUnstaffedUpcomingProjects(a, p, t)

  return [
    {
      key: 'scheduled',
      label: `Produktion ${ANALYTICS_UPCOMING_WINDOW_DAYS} dagar`,
      display: formatSum(projectValueSum(scheduled)),
      projects: scheduled,
      showSum: true,
    },
    {
      key: 'signed',
      label: 'Signerat framåt',
      display: formatSum(projectValueSum(signed)),
      projects: signed,
      showSum: true,
    },
    {
      key: 'delayed',
      label: 'Försenad start · ej inplanerat',
      display: `${delayed.length} projekt`,
      projects: delayed,
      showSum: true,
      warn: delayed.length > 0,
    },
    {
      key: 'active',
      label: 'Pågående idag',
      display: `${active.length} projekt`,
      projects: active,
      showSum: false,
    },
    {
      key: 'unstaffed',
      label: `Saknar bemanning · ${ANALYTICS_UNSTAFFED_LEAD_DAYS} dagar`,
      display: `${unstaffed.length} projekt`,
      projects: unstaffed,
      showSum: false,
      warn: unstaffed.length > 0,
    },
  ]
})

function openCard(card: Card) {
  openProjectListModal({ title: card.label, projects: card.projects, showSum: card.showSum })
}
</script>

<template>
  <section>
    <div class="toolbar">
      <label class="filter-label">Avdelning:
        <select v-model="department">
          <option value="">Alla</option>
          <option v-for="d in departmentOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
        </select>
      </label>
    </div>
    <div class="ms-overview">
      <div
        v-for="card in cards"
        :key="card.key"
        class="ms-stat clickable"
        :class="{ 'ms-stat-warning': card.warn }"
        role="button"
        tabindex="0"
        @click="openCard(card)"
        @keydown.enter.prevent="openCard(card)"
        @keydown.space.prevent="openCard(card)"
      >
        <div class="ms-stat-value">{{ card.display }}</div>
        <div class="ms-stat-label">{{ card.label }}</div>
      </div>
    </div>
  </section>
</template>
