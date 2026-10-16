<script setup lang="ts">
import { DEVIATION_STATUS_LABELS, INSPECTION_STATUS_LABELS, type DeviationStatus, type InspectionStatus } from '../../../shared/inspections'

const props = defineProps<{ status: InspectionStatus | DeviationStatus; deviation?: boolean }>()
const label = computed(() =>
  props.deviation
    ? DEVIATION_STATUS_LABELS[props.status as DeviationStatus]
    : INSPECTION_STATUS_LABELS[props.status as InspectionStatus]
)
</script>

<template>
  <span class="badge" :class="(deviation ? 'dev-' : 'ik-') + status">{{ label }}</span>
</template>
