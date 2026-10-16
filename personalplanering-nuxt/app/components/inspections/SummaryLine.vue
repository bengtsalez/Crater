<script setup lang="ts">
import { PROJECT_INSPECTION_STATE_LABELS } from '../../../shared/inspections'
import type { ProjectInspectionsView } from '../../../shared/inspectionTypes'

// Kort sammanfattning i projektöversikten. Ett projekt utan kontroller visas
// neutralt ("Ingen kontroll tillagd") – aldrig som färdigkontrollerat.
const props = defineProps<{ projectId: number }>()
const emit = defineEmits<{ open: [] }>()
const { api } = useApi()
const data = ref<ProjectInspectionsView | null>(null)
const summaryRev = useState('ik:summaryRev', () => 0)
watch(
  () => [props.projectId, summaryRev.value] as const,
  async ([id]) => {
    data.value = null
    data.value = await api<ProjectInspectionsView>('GET', `/api/projects/${id}/inspections`).catch(() => null)
  },
  { immediate: true }
)
</script>

<template>
  <div v-if="data" class="pd-meta ik-summary-line">
    <span>
      Egenkontroller:
      <button type="button" class="link-button" @click="emit('open')">
        <span class="ik-state-dot" :class="data.summary.state" />{{ PROJECT_INSPECTION_STATE_LABELS[data.summary.state] }}
      </button>
      <template v-if="data.summary.total"> · {{ data.summary.approved }}/{{ data.summary.total }} godkända</template>
      <template v-if="data.summary.submitted"> · {{ data.summary.submitted }} väntar på granskning</template>
      <template v-if="data.summary.open_deviations"> · {{ data.summary.open_deviations }} öppna avvikelser</template>
    </span>
  </div>
</template>
