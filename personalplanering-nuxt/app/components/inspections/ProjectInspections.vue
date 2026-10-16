<script setup lang="ts">
import { PROJECT_INSPECTION_STATE_LABELS } from '../../../shared/inspections'
import type { ProjectInspectionsView } from '../../../shared/inspectionTypes'
import { saveBlob } from '~/composables/useInspection'

// Fliken "Egenkontroller & checklistor" i projektdetaljen.
const props = defineProps<{ projectId: number }>()
const { api } = useApi()
const toast = useToast()
const { refresh: refreshActivity } = useProjectActivity()

const data = ref<ProjectInspectionsView | null>(null)
const loadError = ref('')
const openId = useState<number | null>('pd:inspectionId', () => null)
const adding = ref(false)

async function load() {
  try {
    data.value = await api<ProjectInspectionsView>('GET', `/api/projects/${props.projectId}/inspections`)
    loadError.value = ''
  } catch (err) {
    loadError.value = (err as Error).message
  }
}
watch(() => props.projectId, () => {
  openId.value = null
  load()
}, { immediate: true })

const summaryRev = useState('ik:summaryRev', () => 0)
function changed() {
  summaryRev.value++
  load()
  refreshActivity().catch(() => {})
}

async function protocol() {
  try {
    const res = await ($fetch.raw as any)(`/api/projects/${props.projectId}/inspections/protocol`, { responseType: 'blob' })
    saveBlob(res, 'slutprotokoll.pdf')
  } catch (err) {
    toast.add({ title: errorMessage(err, 'Kunde inte skapa slutprotokollet.'), color: 'error' })
  }
}
const s = computed(() => data.value?.summary)
</script>

<template>
  <section class="ik-project">
    <template v-if="openId">
      <div class="toolbar">
        <button class="plain ghost" @click="openId = null; load()">‹ Alla kontroller på projektet</button>
      </div>
      <InspectionsInspectionForm :base="`/api/inspections/${openId}`" mode="internal" @changed="changed" @open-revision="openId = $event" />
    </template>
    <template v-else>
      <p v-if="loadError" class="emp-error">{{ loadError }} <button class="plain" @click="load">Försök igen</button></p>
      <div v-if="s" class="ik-summary" :class="s.state">
        <strong>{{ PROJECT_INSPECTION_STATE_LABELS[s.state] }}</strong>
        <span v-if="s.total">{{ s.approved }} av {{ s.total }} godkända</span>
        <span v-if="s.unanswered">{{ s.unanswered }} pågår/ej påbörjade</span>
        <span v-if="s.submitted">{{ s.submitted }} väntar på granskning</span>
        <span v-if="s.changes_requested">{{ s.changes_requested }} komplettering krävs</span>
        <span v-if="s.open_deviations" class="ik-warn-text">{{ s.open_deviations }} avvikelser ej verifierade</span>
      </div>
      <div class="toolbar">
        <h3 class="group-title" style="margin: 0">Egenkontroller &amp; checklistor</h3>
        <div class="spacer" />
        <button class="plain" :disabled="!data" @click="protocol"><UIcon name="i-lucide-file-down" /> Slutprotokoll</button>
        <button class="plain primary" @click="adding = true">Lägg till från mall</button>
      </div>
      <InspectionsInspectionTable
        :rows="data?.inspections ?? []"
        :empty-text="data ? 'Inga kontroller tillagda på projektet ännu. Välj Lägg till från mall.' : 'Laddar…'"
        @open="openId = $event.id"
      />
      <InspectionsAddFromTemplateModal v-model:open="adding" :project-id="projectId" @created="changed" />
    </template>
  </section>
</template>
