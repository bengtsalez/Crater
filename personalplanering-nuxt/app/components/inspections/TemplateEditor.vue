<script setup lang="ts">
import { ANSWER_TYPE_LABELS, INSPECTION_KIND_LABELS, INSPECTION_KINDS, type TemplateContent } from '../../../shared/inspections'
import type { InspectionTemplateDetail } from '../../../shared/inspectionTypes'

const props = defineProps<{ templateId: number | 'new'; readOnly: boolean }>()
const emit = defineEmits<{ close: []; opened: [id: number] }>()
const { api } = useApi()
const toast = useToast()
const { options: departmentOptions } = useDepartments()

const detail = ref<InspectionTemplateDetail | null>(null)
const content = ref<TemplateContent>(blank())
const saving = ref(false)
const loadError = ref('')
const savedJson = ref('')

function blank(): TemplateContent {
  return { name: '', kind: 'self_inspection', description: null, department: null, sections: [{ title: '', items: [] }] }
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

async function load() {
  if (props.templateId === 'new') {
    detail.value = null
    content.value = blank()
    savedJson.value = ''
    return
  }
  try {
    detail.value = await api<InspectionTemplateDetail>('GET', `/api/inspection-templates/${props.templateId}`)
    content.value = clone(detail.value.draft ?? detail.value.published ?? blank())
    savedJson.value = JSON.stringify(content.value)
    loadError.value = ''
  } catch (err) {
    loadError.value = (err as Error).message
  }
}
watch(
  () => props.templateId,
  (id) => {
    if (typeof id === 'number' && detail.value?.id === id) return // nyss skapad – redan laddad
    load()
  },
  { immediate: true }
)

const dirty = computed(() => JSON.stringify(content.value) !== savedJson.value)
const isDraft = computed(() => props.templateId === 'new' || !!detail.value?.has_draft || dirty.value)

async function call<T>(fn: () => Promise<T>, success?: string): Promise<T | null> {
  saving.value = true
  try {
    const r = await fn()
    if (success) toast.add({ title: success, color: 'success' })
    return r
  } catch (err) {
    const e = err as ApiError
    toast.add({ title: e.message, color: 'error' })
    if (e.code === 'conflict') await load()
    return null
  } finally {
    saving.value = false
  }
}

/** Sparar utkastet; returnerar mallens id (ny mall skapas vid första sparningen). */
async function saveDraft(): Promise<number | null> {
  if (props.templateId === 'new') {
    const t = await call(() => api<InspectionTemplateDetail>('POST', '/api/inspection-templates', content.value), 'Utkastet sparat')
    if (!t) return null
    detail.value = t
    savedJson.value = JSON.stringify(content.value)
    emit('opened', t.id)
    return t.id
  }
  const t = await call(
    () => api<InspectionTemplateDetail>('PUT', `/api/inspection-templates/${props.templateId}`, { content: content.value, draft_rev: detail.value!.draft_rev }),
    'Utkastet sparat'
  )
  if (!t) return null
  detail.value = t
  savedJson.value = JSON.stringify(content.value)
  return t.id
}

async function publish() {
  const id = dirty.value || props.templateId === 'new' ? await saveDraft() : (props.templateId as number)
  if (!id || !detail.value) return
  const next = detail.value.latest_version + 1
  if (!confirm(`Publicera som version ${next}? Publicerade versioner kan inte ändras.`)) return
  const t = await call(
    () => api<InspectionTemplateDetail>('POST', `/api/inspection-templates/${id}/publish`, { draft_rev: detail.value!.draft_rev }),
    `Version ${next} publicerad`
  )
  if (t) {
    detail.value = t
    content.value = clone(t.draft ?? t.published ?? content.value)
    savedJson.value = JSON.stringify(content.value)
  }
}

async function discard() {
  if (!confirm('Kasta utkastet och återgå till senast publicerade version?')) return
  if (await call(() => api('POST', `/api/inspection-templates/${props.templateId}/discard`, { draft_rev: detail.value!.draft_rev }), 'Utkastet kastat')) await load()
}

async function duplicate() {
  const t = await call(() => api<InspectionTemplateDetail>('POST', `/api/inspection-templates/${props.templateId}/duplicate`), 'Mallen duplicerad')
  if (t) emit('opened', t.id)
}

async function setArchived(archived: boolean) {
  if (archived && !confirm('Arkivera mallen? Den går inte att välja för nya kontroller, men befintliga kontroller påverkas inte.')) return
  if (await call(() => api('POST', `/api/inspection-templates/${props.templateId}/archive`, { archived }), archived ? 'Mallen arkiverad' : 'Mallen återställd')) await load()
}

function back() {
  if (dirty.value && !confirm('Du har osparade ändringar. Lämna ändå?')) return
  emit('close')
}
</script>

<template>
  <div class="ik-template">
    <div class="toolbar">
      <button class="plain ghost" @click="back">‹ Alla mallar</button>
      <div class="spacer" />
      <template v-if="!readOnly && detail?.status !== 'archived'">
        <span v-if="dirty" class="ik-unsaved-text">Ej sparat</span>
        <button v-if="detail?.has_draft && detail.latest_version > 0" class="plain ghost" :disabled="saving" @click="discard">Kasta utkast</button>
        <button class="plain" :disabled="saving || !dirty" @click="saveDraft">Spara utkast</button>
        <button class="plain primary" :disabled="saving || !isDraft" @click="publish">Publicera</button>
      </template>
      <template v-if="!readOnly && detail">
        <button class="plain" :disabled="saving" @click="duplicate">Duplicera</button>
        <button v-if="detail.status === 'active'" class="plain ghost" :disabled="saving" @click="setArchived(true)">Arkivera</button>
        <button v-else class="plain" :disabled="saving" @click="setArchived(false)">Återställ</button>
      </template>
    </div>
    <p v-if="loadError" class="emp-error">{{ loadError }}</p>

    <div v-if="detail" class="ik-template-meta">
      <span>{{ detail.latest_version ? `Senast publicerad: version ${detail.latest_version}` : 'Inte publicerad ännu' }}</span>
      <span v-if="detail.has_draft && !readOnly"> · Utkast pågår</span>
      <span v-if="detail.status === 'archived'"> · Arkiverad</span>
      <span v-if="detail.versions.length" class="hint">
        · Versioner: {{ detail.versions.map((v) => `v${v.version} (${new Date(v.published_at).toLocaleDateString('sv-SE')}${v.published_by_name ? `, ${v.published_by_name}` : ''})`).join(', ') }}
      </span>
    </div>

    <!-- Läsläge (projektledare) -->
    <template v-if="readOnly">
      <h2 class="ik-title">{{ content.name }}</h2>
      <p class="hint">{{ INSPECTION_KIND_LABELS[content.kind] }}<template v-if="content.description"> – {{ content.description }}</template></p>
      <div v-for="(s, si) in content.sections" :key="si" class="ik-section">
        <h3 v-if="s.title" class="ik-section-title">{{ s.title }}</h3>
        <ul class="ik-readonly-items">
          <li v-for="it in s.items" :key="it.key">
            <strong>{{ it.title }}</strong>
            <span class="hint"> · {{ ANSWER_TYPE_LABELS[it.answer_type] }}{{ it.required ? ' · obligatorisk' : '' }}{{ it.min_photos ? ` · ${it.min_photos} foto` : '' }}{{ it.critical ? ' · kritiskt' : '' }}</span>
          </li>
        </ul>
      </div>
    </template>

    <form v-else class="pp-form ik-template-form" @submit.prevent="saveDraft">
      <div class="row-2">
        <label>Namn *<input v-model="content.name" required maxlength="200" :disabled="detail?.status === 'archived'"></label>
        <label>Typ
          <select v-model="content.kind" :disabled="detail?.status === 'archived'">
            <option v-for="k in INSPECTION_KINDS" :key="k" :value="k">{{ INSPECTION_KIND_LABELS[k] }}</option>
          </select>
        </label>
        <label>Avdelning
          <select :value="content.department ?? ''" :disabled="detail?.status === 'archived'" @change="content.department = ($event.target as HTMLSelectElement).value || null">
            <option value="">Alla</option>
            <option v-for="d in departmentOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </label>
      </div>
      <label>Beskrivning
        <textarea :value="content.description ?? ''" rows="2" :disabled="detail?.status === 'archived'" @input="content.description = ($event.target as HTMLTextAreaElement).value || null" />
      </label>
      <p class="hint">
        En <strong>checklista</strong> bekräftar att praktiska uppgifter är utförda. En <strong>egenkontroll</strong> dokumenterar dessutom vad som kontrollerats, mot vilket underlag, med vilken metod och resultat.
      </p>
      <InspectionsSectionsEditor v-model="content.sections" />
    </form>
  </div>
</template>
