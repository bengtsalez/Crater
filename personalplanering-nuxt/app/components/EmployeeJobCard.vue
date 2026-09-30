<script setup lang="ts">
import type { EmployeeJob } from '~/types'
import { formatBookingPeriod, remainingTasksLabel } from '~/utils/employeeJobs'

defineProps<{ job: EmployeeJob }>()
</script>

<template>
  <NuxtLink :to="`/personal/arbete/${job.project_id}`" class="emp-card">
    <div class="emp-card-head">
      <span class="emp-card-number">{{ job.project_number }}</span>
      <span class="emp-card-tasks" :class="{ done: !job.remaining_tasks }">{{ remainingTasksLabel(job.remaining_tasks) }}</span>
    </div>
    <div class="emp-card-title">{{ job.project_name }}</div>
    <div class="emp-card-row">
      <UIcon name="i-lucide-calendar" />
      <span>{{ formatBookingPeriod(job.start_date, job.end_date) }}</span>
    </div>
    <div class="emp-card-row" :class="{ muted: !job.site_address }">
      <UIcon name="i-lucide-map-pin" />
      <span>{{ job.site_address || 'Ingen adress angiven' }}</span>
    </div>
    <div v-if="job.note" class="emp-card-row muted">
      <UIcon name="i-lucide-sticky-note" />
      <span>{{ job.note }}</span>
    </div>
    <UIcon name="i-lucide-chevron-right" class="emp-card-chevron" />
  </NuxtLink>
</template>
