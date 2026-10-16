<script setup lang="ts">
import { INSPECTION_KIND_LABELS } from '../../../shared/inspections'
import type { InspectionListRow } from '../../../shared/inspectionTypes'

defineProps<{ rows: InspectionListRow[]; showProject?: boolean; emptyText: string }>()
const emit = defineEmits<{ open: [row: InspectionListRow] }>()
</script>

<template>
  <table class="data-table ik-table">
    <thead>
      <tr>
        <th v-if="showProject">Projekt</th>
        <th>Kontroll</th>
        <th>Plats / etapp</th>
        <th>Ansvarig</th>
        <th>Sista datum</th>
        <th>Status</th>
        <th>Obligatoriska</th>
        <th>Avvikelser</th>
      </tr>
    </thead>
    <tbody>
      <tr v-if="!rows.length"><td :colspan="showProject ? 8 : 7" class="empty-state">{{ emptyText }}</td></tr>
      <tr v-for="r in rows" :key="r.id" class="clickable" @click="emit('open', r)">
        <td v-if="showProject" data-label="Projekt">{{ r.project_number }} – {{ r.project_name }}</td>
        <td data-label="Kontroll">
          {{ r.name }}
          <span class="hint">{{ INSPECTION_KIND_LABELS[r.kind] }}<template v-if="r.revision > 1"> · rev {{ r.revision }}</template></span>
        </td>
        <td data-label="Plats / etapp">{{ r.location || '–' }}</td>
        <td data-label="Ansvarig">{{ r.responsible_name || '–' }}</td>
        <td data-label="Sista datum">{{ r.due_date || '–' }}</td>
        <td data-label="Status"><InspectionsStatusBadge :status="r.status" /></td>
        <td data-label="Obligatoriska"><InspectionsCoverageBar :coverage="r.coverage" compact /></td>
        <td data-label="Avvikelser">
          <span v-if="r.open_deviations" class="badge dev-open">{{ r.open_deviations }} öppna</span>
          <span v-else class="hint">–</span>
        </td>
      </tr>
    </tbody>
  </table>
</template>
