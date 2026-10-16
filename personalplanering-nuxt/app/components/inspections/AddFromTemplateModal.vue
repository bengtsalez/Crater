<script setup lang="ts">
import { INSPECTION_KIND_LABELS } from '../../../shared/inspections'
import type { InspectionTemplateSummary } from '../../../shared/inspectionTypes'

// "Lägg till från mall": en eller flera rader (samma mall kan väljas flera
// gånger, t.ex. en per etapp) med ansvarig, plats och sista datum.
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ projectId: number }>()
const emit = defineEmits<{ created: [] }>()
const { api } = useApi()
const { users } = useAppData()
const toast = useToast()
const isMobile = useIsMobile()

const templates = ref<InspectionTemplateSummary[]>([])
const loadError = ref('')
const saving = ref(false)
interface Row { template_id: number | ''; location: string; due_date: string; responsible_user_id: number | '' }
const rows = ref<Row[]>([])
const blank = (): Row => ({ template_id: templates.value[0]?.id ?? '', location: '', due_date: '', responsible_user_id: '' })

watch(open, async (v) => {
  if (!v) return
  loadError.value = ''
  try {
    templates.value = await api<InspectionTemplateSummary[]>('GET', '/api/inspection-templates')
  } catch (err) {
    loadError.value = (err as Error).message
  }
  rows.value = [blank()]
})

const people = computed(() => users.value.filter((u) => u.active !== false && ['admin', 'member', 'employee'].includes(u.role ?? '')))

async function submit() {
  if (rows.value.some((r) => !r.template_id)) return
  saving.value = true
  try {
    await api('POST', `/api/projects/${props.projectId}/inspections`, {
      inspections: rows.value.map((r) => ({
        template_id: r.template_id,
        location: r.location || null,
        due_date: r.due_date || null,
        responsible_user_id: r.responsible_user_id || null,
      })),
    })
    toast.add({ title: rows.value.length === 1 ? 'Kontrollen är tillagd' : `${rows.value.length} kontroller är tillagda`, color: 'success' })
    open.value = false
    emit('created')
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :fullscreen="isMobile" title="Lägg till från mall" :ui="{ content: 'sm:max-w-3xl' }">
    <template #body>
      <p v-if="loadError" class="emp-error">{{ loadError }}</p>
      <p v-else-if="!templates.length" class="empty-state">
        Det finns inga publicerade mallar ännu. En administratör skapar mallar under fliken Egenkontroller → Mallar.
      </p>
      <form v-else class="pp-form" @submit.prevent="submit">
        <div v-for="(r, i) in rows" :key="i" class="ik-add-row">
          <label>Mall *
            <select v-model="r.template_id" required>
              <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }} ({{ INSPECTION_KIND_LABELS[t.kind] }}, v{{ t.latest_version }})</option>
            </select>
          </label>
          <div class="row-2">
            <label>Plats eller etapp<input v-model="r.location" maxlength="200" placeholder="t.ex. Norrsida"></label>
            <label>Sista datum<input v-model="r.due_date" type="date"></label>
          </div>
          <div class="row-2">
            <label>Huvudansvarig
              <select v-model="r.responsible_user_id">
                <option value="">–</option>
                <option v-for="u in people" :key="u.id" :value="u.id">{{ u.username }}{{ u.role === 'employee' ? ' (personal)' : '' }}</option>
              </select>
            </label>
            <div class="ik-add-row-tools">
              <button v-if="rows.length > 1" type="button" class="plain danger" @click="rows.splice(i, 1)">Ta bort rad</button>
            </div>
          </div>
        </div>
        <button type="button" class="plain ghost" @click="rows.push({ ...rows.at(-1)!, location: '' })">+ Ytterligare en kontroll</button>
        <p class="hint">Personal ser bara kontroller där de är huvudansvariga och samtidigt är bokade på projektet.</p>
        <div class="modal-actions">
          <div class="spacer" />
          <button type="button" class="plain ghost" @click="open = false">Avbryt</button>
          <button type="submit" class="plain primary" :disabled="saving">Lägg till</button>
        </div>
      </form>
    </template>
  </UModal>
</template>
