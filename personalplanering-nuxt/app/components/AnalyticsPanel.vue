<script setup lang="ts">
import {
  filterProjectsByDepartment,
  getUpcomingScheduledValue,
  getFutureSignedValue,
  getActiveProjectsToday,
  getUnstaffedUpcomingProjects,
} from '~/utils/analytics'
import { formatSum } from '~/utils/format'

const { projects, assignments } = useAppData()
const { options: departmentOptions } = useDepartments()
const { openUnstaffedModal } = useModals()

const department = ref('')

const filtered = computed(() => filterProjectsByDepartment(projects.value, department.value))

const today = new Date()
const scheduled = computed(() => getUpcomingScheduledValue(assignments.value, filtered.value, today))
const signed = computed(() => getFutureSignedValue(filtered.value))
const active = computed(() => getActiveProjectsToday(filtered.value))
const unstaffed = computed(() => getUnstaffedUpcomingProjects(assignments.value, filtered.value, today))

function openDrilldown() {
  openUnstaffedModal(unstaffed.value)
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
      <div class="ms-stat">
        <div class="ms-stat-value">{{ formatSum(scheduled) }}</div>
        <div class="ms-stat-label">Inplanerat 30 dagar</div>
      </div>
      <div class="ms-stat">
        <div class="ms-stat-value">{{ formatSum(signed) }}</div>
        <div class="ms-stat-label">Signerat framåt</div>
      </div>
      <div class="ms-stat">
        <div class="ms-stat-value">{{ active }} projekt</div>
        <div class="ms-stat-label">Pågående idag</div>
      </div>
      <div
        class="ms-stat clickable"
        :class="{ 'ms-stat-warning': unstaffed.length > 0 }"
        role="button"
        tabindex="0"
        @click="openDrilldown"
        @keydown.enter.prevent="openDrilldown"
        @keydown.space.prevent="openDrilldown"
      >
        <div class="ms-stat-value">{{ unstaffed.length }} projekt</div>
        <div class="ms-stat-label">Saknar bemanning</div>
      </div>
    </div>
  </section>
</template>
