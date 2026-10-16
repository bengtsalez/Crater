<script setup lang="ts">
import { RESULT_LABELS, type AnswerValue, type ResultValue } from '../../../shared/inspections'
import type { DeviationView, InspectionItemView } from '../../../shared/inspectionTypes'
import type { ItemSaveState } from '~/composables/useInspection'

// En kontrollpunkt: instruktion och underlag nära frågan, stora knappar för
// resultat, fritext/mätvärde, foton och eventuell avvikelse. "Obesvarad" är
// ett eget läge – inget förval. Sparat visas först när servern bekräftat.
const props = defineProps<{
  item: InspectionItemView
  index: number
  canAnswer: boolean
  state?: { state: ItemSaveState; message?: string }
  uploadingCount: number
  storageConfigured: boolean
  photoBase: string
  deviation: DeviationView | null
}>()
const emit = defineEmits<{
  save: [value: Partial<AnswerValue>]
  upload: [file: File]
  removePhoto: [id: string]
  reload: []
}>()

// Lokalt utkast för textfält; resultatknappar sparas direkt.
const draft = reactive({ comment: '', na_reason: '', text_value: '', number_value: '', date_value: '' })
function syncDraft() {
  const a = props.item.answer
  draft.comment = a?.comment ?? ''
  draft.na_reason = a?.na_reason ?? ''
  draft.text_value = a?.text_value ?? ''
  draft.number_value = a?.number_value?.replace('.', ',') ?? ''
  draft.date_value = a?.date_value ?? ''
}
syncDraft()
watch(() => [props.item.rev, props.item.answer?.answered_at], syncDraft)

const result = computed<ResultValue | null>(() => props.item.answer?.result ?? null)
const dirty = computed(() => {
  const a = props.item.answer
  return (
    draft.comment !== (a?.comment ?? '') ||
    draft.na_reason !== (a?.na_reason ?? '') ||
    draft.text_value !== (a?.text_value ?? '') ||
    draft.number_value !== (a?.number_value?.replace('.', ',') ?? '') ||
    draft.date_value !== (a?.date_value ?? '')
  )
})

function payload(over: Partial<AnswerValue> = {}): Partial<AnswerValue> {
  return {
    result: result.value,
    checked: props.item.answer?.checked ?? null,
    text_value: draft.text_value || null,
    number_value: draft.number_value || null,
    date_value: draft.date_value || null,
    comment: draft.comment || null,
    na_reason: draft.na_reason || null,
    ...over,
  }
}

function setResult(r: ResultValue | null) {
  if (!props.canAnswer) return
  emit('save', payload({ result: r }))
}
function setChecked(v: boolean) {
  emit('save', payload({ checked: v, result: v ? null : result.value }))
}
function saveText() {
  if (dirty.value) emit('save', payload())
}

const fileInput = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)
function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  for (const f of Array.from(input.files ?? [])) emit('upload', f)
  input.value = ''
}

const showNa = computed(() => result.value === 'na')
const resultOptions = computed<ResultValue[]>(() => (props.item.answer_type === 'result' ? ['ok', 'deviation', 'na'] : ['deviation', 'na']))
const photosOk = computed(() => props.item.photos.length >= props.item.min_photos)
const answeredAt = computed(() =>
  props.item.answer ? new Date(props.item.answer.answered_at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : ''
)
</script>

<template>
  <article class="ik-item" :class="{ critical: item.critical, incomplete: !item.evaluation.complete && item.evaluation.answered, answered: item.evaluation.answered }">
    <header class="ik-item-head">
      <span class="ik-item-num">{{ index }}</span>
      <h3 class="ik-item-title">{{ item.title }}<span v-if="item.required" class="ik-req" title="Obligatorisk"> *</span></h3>
      <span class="ik-item-state" :class="item.evaluation.complete && item.evaluation.answered ? 'ok' : item.evaluation.answered ? 'warn' : 'none'">
        {{ item.evaluation.answered ? (item.evaluation.complete ? 'Klar' : 'Ofullständig') : 'Obesvarad' }}
      </span>
    </header>

    <div v-if="item.critical" class="ik-critical" role="note">
      <UIcon name="i-lucide-triangle-alert" />
      <span><strong>Kritiskt moment.</strong> {{ item.timing_note || 'Kontrollera innan arbetet går vidare.' }}</span>
    </div>
    <p v-else-if="item.timing_note" class="ik-timing"><UIcon name="i-lucide-clock" /> {{ item.timing_note }}</p>

    <div v-if="item.instruction || item.basis || item.method" class="ik-guidance">
      <p v-if="item.instruction" class="ik-instruction">{{ item.instruction }}</p>
      <p v-if="item.basis || item.basis_url" class="ik-meta-line">
        <UIcon name="i-lucide-file-text" />
        <span>Underlag: {{ item.basis || 'Länk' }}</span>
        <a v-if="item.basis_url" :href="item.basis_url" target="_blank" rel="noopener noreferrer" class="ik-link">Öppna</a>
      </p>
      <p v-if="item.method" class="ik-meta-line"><UIcon name="i-lucide-search-check" /> <span>Metod: {{ item.method }}</span></p>
    </div>

    <!-- Svar -->
    <div class="ik-answer">
      <label v-if="item.answer_type === 'checkbox'" class="ik-check" :class="{ on: item.answer?.checked }">
        <input type="checkbox" :checked="!!item.answer?.checked" :disabled="!canAnswer" @change="setChecked(($event.target as HTMLInputElement).checked)">
        <span>Utförd</span>
      </label>
      <label v-else-if="item.answer_type === 'text'" class="ik-field">
        <span class="ik-field-label">Svar</span>
        <textarea v-model="draft.text_value" rows="2" :disabled="!canAnswer" @blur="saveText" />
      </label>
      <label v-else-if="item.answer_type === 'number'" class="ik-field ik-number">
        <span class="ik-field-label">Mätvärde</span>
        <span class="ik-number-row">
          <input v-model="draft.number_value" inputmode="decimal" :disabled="!canAnswer" placeholder="0" @blur="saveText">
          <span v-if="item.unit" class="ik-unit">{{ item.unit }}</span>
        </span>
      </label>
      <label v-else-if="item.answer_type === 'date'" class="ik-field">
        <span class="ik-field-label">Datum</span>
        <input v-model="draft.date_value" type="date" :disabled="!canAnswer" @change="saveText">
      </label>

      <div class="ik-results" role="group" :aria-label="`Resultat för ${item.title}`">
        <button
          v-for="r in resultOptions"
          :key="r"
          type="button"
          class="plain ik-result"
          :class="[r, { active: result === r }]"
          :aria-pressed="result === r"
          :disabled="!canAnswer"
          @click="setResult(result === r ? null : r)"
        >
          <UIcon :name="r === 'ok' ? 'i-lucide-check' : r === 'deviation' ? 'i-lucide-triangle-alert' : 'i-lucide-minus'" />
          {{ RESULT_LABELS[r] }}
        </button>
      </div>

      <label v-if="showNa" class="ik-field">
        <span class="ik-field-label">Motivering till Ej tillämplig *</span>
        <textarea v-model="draft.na_reason" rows="2" :disabled="!canAnswer" @blur="saveText" />
      </label>
      <label class="ik-field">
        <span class="ik-field-label">
          {{ result === 'deviation' ? 'Beskriv avvikelsen *' : item.comment_required ? 'Kommentar *' : 'Kommentar' }}
        </span>
        <textarea v-model="draft.comment" rows="2" :disabled="!canAnswer" @blur="saveText" />
      </label>
      <div v-if="canAnswer && dirty" class="ik-unsaved">
        <span>Ej sparat</span>
        <button type="button" class="plain primary" @click="saveText">Spara</button>
      </div>
    </div>

    <!-- Foton -->
    <div v-if="item.min_photos || item.photos.length || canAnswer" class="ik-photos">
      <div class="ik-photos-head">
        <span :class="{ 'ik-warn-text': item.min_photos && !photosOk && result !== 'na' }">
          Bilder {{ item.photos.length }}<template v-if="item.min_photos"> av minst {{ item.min_photos }}</template>
        </span>
      </div>
      <InspectionsPhotoGrid :photos="item.photos" :base="photoBase" :can-remove="canAnswer" @remove="emit('removePhoto', $event)" />
      <template v-if="canAnswer">
        <p v-if="!storageConfigured" class="ik-storage-missing">Bildlagring är inte konfigurerad – bilder kan inte laddas upp. Kontakta administratören.</p>
        <div v-else class="ik-photo-actions">
          <button type="button" class="plain emp-btn" :disabled="uploadingCount > 0" @click="cameraInput?.click()"><UIcon name="i-lucide-camera" /> Ta foto</button>
          <button type="button" class="plain emp-btn" :disabled="uploadingCount > 0" @click="fileInput?.click()"><UIcon name="i-lucide-image-plus" /> Välj bild</button>
          <span v-if="uploadingCount" class="ik-saving">Laddar upp…</span>
          <input ref="cameraInput" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden @change="onFiles">
          <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="onFiles">
        </div>
      </template>
    </div>

    <slot name="deviation" :deviation="deviation" />

    <footer class="ik-item-foot">
      <ul v-if="item.evaluation.problems.length && item.evaluation.answered" class="ik-problems">
        <li v-for="p in item.evaluation.problems" :key="p">{{ p }}</li>
      </ul>
      <span v-if="state?.state === 'saving'" class="ik-saving">Sparar…</span>
      <span v-else-if="state?.state === 'saved'" class="ik-saved"><UIcon name="i-lucide-check" /> Sparad</span>
      <span v-else-if="state?.state === 'error'" class="ik-save-error" role="alert">{{ state.message }}</span>
      <span v-else-if="state?.state === 'conflict'" class="ik-save-error" role="alert">
        {{ state.message }} <button type="button" class="plain" @click="emit('reload')">Ladda om</button>
      </span>
      <span v-if="item.answer" class="ik-answered-by">{{ item.answer.answered_by_name }} · {{ answeredAt }}</span>
    </footer>
  </article>
</template>
