<script setup lang="ts">
import type { Task } from '~/types'

const props = withDefaults(
  defineProps<{
    task: Task
    showOwner?: boolean
    readOnly?: boolean
  }>(),
  { showOwner: false, readOnly: false }
)

const emit = defineEmits<{
  toggle: [task: Task]
  edit: [task: Task]
  delete: [task: Task]
}>()

const toggleLabel = computed(() => (props.task.status === 'avslutad' ? 'Återöppna' : 'Klarmarkera'))
</script>

<template>
  <div class="task-row" :data-id="task.id">
    <div class="task-main">
      <div class="task-title">{{ task.title }}</div>
      <div class="task-meta">
        <span v-if="showOwner" class="task-owner">{{ task.username }}</span>
        <span v-else class="task-project">
          <template v-if="task.project_id">{{ task.project_number }} – {{ task.project_name }}</template>
          <span v-else class="task-no-project">Inget projekt</span>
        </span>
        <span v-if="task.due_date" class="task-due">Förfaller: {{ task.due_date }}</span>
      </div>
    </div>
    <div v-if="!readOnly" class="task-actions">
      <button class="plain ghost" @click="emit('toggle', task)">{{ toggleLabel }}</button>
      <button class="plain ghost" @click="emit('edit', task)">Redigera</button>
      <button class="plain danger" @click="emit('delete', task)">Ta bort</button>
    </div>
  </div>
</template>
