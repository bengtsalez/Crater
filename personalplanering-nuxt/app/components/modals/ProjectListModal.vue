<script setup lang="ts">
import { effectiveStart, projectValueSum } from '~/utils/analytics'
import { formatSum } from '~/utils/format'

const { projectList: modal } = useModals()
const { assignments } = useAppData()
const { labelFor: departmentLabel } = useDepartments()
const isMobile = useIsMobile()

const open = computed({
  get: () => modal.value.open,
  set: (v) => {
    modal.value = { ...modal.value, open: v }
  },
})

const total = computed(() => projectValueSum(modal.value.projects))
</script>

<template>
  <UModal v-model:open="open" :fullscreen="isMobile" :title="modal.title">
    <template #body>
      <div v-if="!modal.projects.length" class="empty-state">
        Inga projekt.
      </div>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th>Projektnr</th>
            <th>Namn</th>
            <th>Avdelning</th>
            <th>Start</th>
            <th>Byggslut</th>
            <th v-if="modal.showSum" class="num">Summa</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in modal.projects" :key="p.id">
            <td data-label="Projektnr">{{ p.project_number }}</td>
            <td data-label="Namn">{{ p.name }}</td>
            <td data-label="Avdelning">{{ departmentLabel(p.category) }}</td>
            <td data-label="Start">{{ effectiveStart(assignments, p).date || '–' }}</td>
            <td data-label="Byggslut">{{ p.end_date || '–' }}</td>
            <td v-if="modal.showSum" data-label="Summa" class="num">{{ formatSum(p.sum) }}</td>
          </tr>
        </tbody>
        <tfoot v-if="modal.showSum">
          <tr>
            <td colspan="5">Totalt</td>
            <td class="num">{{ formatSum(total) }}</td>
          </tr>
        </tfoot>
      </table>
    </template>
    <template #footer>
      <div class="spacer" />
      <button class="plain ghost" @click="open = false">Stäng</button>
    </template>
  </UModal>
</template>
