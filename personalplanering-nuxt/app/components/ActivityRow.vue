<script setup lang="ts">
import type { ActivityEvent } from '~/types'
import { formatActivity } from '~/utils/activity'
import { formatActivityTime } from '~/utils/format'

const props = defineProps<{ event: ActivityEvent }>()
const display = computed(() => formatActivity(props.event))
</script>

<template>
  <div class="activity-row">
    <UIcon :name="display.icon" class="activity-icon" />
    <div class="activity-main">
      <div class="activity-title">{{ display.title }}</div>
      <div v-if="display.secondary" class="activity-secondary">{{ display.secondary }}</div>
    </div>
    <div class="activity-time">{{ formatActivityTime(event.created_at) }}</div>
  </div>
</template>
