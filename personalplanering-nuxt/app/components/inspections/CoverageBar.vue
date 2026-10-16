<script setup lang="ts">
import type { Coverage } from '../../../shared/inspections'

// Svarstäckning visas separat från godkännandestatus.
const props = defineProps<{ coverage: Coverage; compact?: boolean }>()
const pct = computed(() =>
  props.coverage.required_total ? Math.round((props.coverage.required_answered / props.coverage.required_total) * 100) : 0
)
</script>

<template>
  <div class="ik-coverage" :class="{ compact }" :title="`${coverage.required_answered} av ${coverage.required_total} obligatoriska punkter besvarade`">
    <div class="ik-coverage-bar"><div class="ik-coverage-fill" :style="{ width: pct + '%' }" /></div>
    <span class="ik-coverage-text">
      {{ coverage.required_answered }}/{{ coverage.required_total }}<template v-if="!compact"> obligatoriska besvarade</template>
    </span>
  </div>
</template>
