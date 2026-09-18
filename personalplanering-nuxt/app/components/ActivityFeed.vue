<script setup lang="ts">
import type { ActivityEvent } from '~/types'
import { groupActivitiesByDay } from '~/utils/format'

const props = defineProps<{ activities: ActivityEvent[] }>()
const groups = computed(() => groupActivitiesByDay(props.activities))
</script>

<template>
  <div class="activity-feed">
    <div v-if="!activities.length" class="empty-state">Ingen aktivitet ännu.</div>
    <template v-for="group in groups" :key="group.bucket">
      <div class="activity-day-label">{{ group.label }}</div>
      <ActivityRow v-for="e in group.items" :key="e.id" :event="e" />
    </template>
  </div>
</template>
