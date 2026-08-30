<script setup lang="ts">
import { effectiveStart } from '~/utils/analytics'

const { unstaffed: modal } = useModals()
const { assignments } = useAppData()

const open = computed({
  get: () => modal.value.open,
  set: (v) => {
    modal.value = { ...modal.value, open: v }
  },
})
</script>

<template>
  <UModal v-model:open="open" title="Projekt utan bemanning">
    <template #body>
      <div class="task-list">
        <div v-if="!modal.projects.length" class="empty-state">
          Inga projekt utan bemanning inom de närmaste dagarna.
        </div>
        <div v-for="p in modal.projects" :key="p.id" class="task-row">
          <div class="task-main">
            <div class="task-title">{{ p.project_number }} – {{ p.name }}</div>
            <div class="task-meta">
              <span>Start: {{ effectiveStart(assignments, p).date }}</span>
              <span v-if="p.client">{{ p.client }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="spacer" />
      <button class="plain ghost" @click="open = false">Stäng</button>
    </template>
  </UModal>
</template>
