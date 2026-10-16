<script setup lang="ts">
import { INSPECTION_KIND_LABELS } from '../../../shared/inspections'
import type { InspectionTemplateSummary } from '../../../shared/inspectionTypes'

// Företagets mallar. Admin skapar, redigerar, duplicerar, publicerar och
// arkiverar; projektledare ser publicerade mallar.
const { api } = useApi()
const { currentUser } = useAppData()
const toast = useToast()
const isAdmin = computed(() => currentUser.value?.role === 'admin')
const templates = ref<InspectionTemplateSummary[]>([])
const loadError = ref('')
const editId = useState<number | 'new' | null>('ik:templateId', () => null)
const showArchived = ref(false)

async function load() {
  try {
    templates.value = await api<InspectionTemplateSummary[]>('GET', `/api/inspection-templates${isAdmin.value ? '?all=1' : ''}`)
    loadError.value = ''
  } catch (err) {
    loadError.value = (err as Error).message
  }
}
onMounted(load)
const shown = computed(() => templates.value.filter((t) => showArchived.value || t.status === 'active'))

async function importExamples() {
  try {
    const r = await api<{ added: number; skipped: number }>('POST', '/api/inspection-templates/examples')
    toast.add({
      title: r.added ? `${r.added} exempelmallar tillagda` : 'Exempelmallarna finns redan',
      description: r.added ? 'Anpassa dem till projektets krav och produktanvisningar före användning.' : undefined,
      color: 'success',
    })
    await load()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}
function closed() {
  editId.value = null
  load()
}
</script>

<template>
  <div>
    <InspectionsTemplateEditor v-if="editId" :template-id="editId" :read-only="!isAdmin" @close="closed" @opened="editId = $event" />
    <template v-else>
      <div class="toolbar">
        <p class="hint" style="margin: 0">
          Publicerade versioner är oföränderliga. Ändringar görs i ett utkast som publiceras som nästa version – befintliga kontroller påverkas inte.
        </p>
        <div class="spacer" />
        <template v-if="isAdmin">
          <label class="checkbox-label ik-inline"><input v-model="showArchived" type="checkbox"> Visa arkiverade</label>
          <button class="plain" @click="importExamples">Lägg till exempelmallar</button>
          <button class="plain primary" @click="editId = 'new'">+ Ny mall</button>
        </template>
      </div>
      <p v-if="loadError" class="emp-error">{{ loadError }}</p>
      <table class="data-table">
        <thead><tr><th>Mall</th><th>Typ</th><th>Version</th><th>Punkter</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-if="!shown.length">
            <td colspan="5" class="empty-state">
              {{ isAdmin ? 'Inga mallar ännu. Skapa en ny mall eller lägg till exempelmallar.' : 'Inga publicerade mallar ännu. En administratör skapar företagets mallar.' }}
            </td>
          </tr>
          <tr v-for="t in shown" :key="t.id" class="clickable" @click="editId = t.id">
            <td data-label="Mall">{{ t.name }}<span v-if="t.is_example" class="hint"> · exempel</span></td>
            <td data-label="Typ">{{ INSPECTION_KIND_LABELS[t.kind] }}</td>
            <td data-label="Version">{{ t.latest_version ? `v${t.latest_version}` : 'Ej publicerad' }}<span v-if="t.has_draft && isAdmin" class="hint"> · utkast</span></td>
            <td data-label="Punkter">{{ t.item_count }}</td>
            <td data-label="Status"><span class="badge" :class="t.status === 'active' ? 'aktiv' : 'avslutad'">{{ t.status === 'active' ? 'Aktiv' : 'Arkiverad' }}</span></td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
