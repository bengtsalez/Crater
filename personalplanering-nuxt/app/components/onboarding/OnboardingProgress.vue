<script setup lang="ts">
import { ONBOARDING_STEPS } from '~/composables/useOnboarding'

const props = defineProps<{
  step: number
  completed: number[]
  skipped: number[]
}>()

const emit = defineEmits<{ (e: 'go', step: number): void }>()

function stateFor(index: number): 'done' | 'skipped' | 'current' | 'todo' {
  const n = index + 1
  if (n === props.step) return 'current'
  if (props.completed.includes(n)) return 'done'
  if (props.skipped.includes(n)) return 'skipped'
  return 'todo'
}
</script>

<template>
  <ol class="ob-progress">
    <li
      v-for="(s, i) in ONBOARDING_STEPS"
      :key="s.key"
      class="ob-progress-item"
      :class="stateFor(i)"
    >
      <button
        type="button"
        class="ob-progress-btn"
        :disabled="i + 1 === step"
        @click="emit('go', i + 1)"
      >
        <span class="ob-progress-num">{{ i + 1 }}</span>
        <span class="ob-progress-label">{{ s.label }}</span>
      </button>
    </li>
  </ol>
</template>
