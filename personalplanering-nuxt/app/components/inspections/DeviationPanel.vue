<script setup lang="ts">
import type { DeviationView } from '../../../shared/inspectionTypes'

// Avvikelse kopplad till en punkt. Personal dokumenterar åtgärd (text + bild);
// projektledare/administratör sätter ansvarig och sista datum, verifierar,
// återöppnar (med motivering) och kan koppla en uppgift.
const props = defineProps<{
  deviation: DeviationView
  reviewer: boolean
  editable: boolean
  photoBase: string
  storageConfigured: boolean
  uploadingCount: number
  responsibleOptions?: { id: number; username: string }[]
}>()
const emit = defineEmits<{
  resolve: [action: string]
  verify: []
  reopen: [reason: string]
  update: [patch: { responsible_user_id?: number | null; due_date?: string | null }]
  task: []
  upload: [file: File]
  removePhoto: [id: string]
}>()

const action = ref(props.deviation.action_description ?? '')
const reason = ref('')
const showReopen = ref(false)
watch(() => props.deviation.rev, () => {
  action.value = props.deviation.action_description ?? ''
  showReopen.value = false
  reason.value = ''
})
const fileInput = ref<HTMLInputElement | null>(null)
function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  for (const f of Array.from(input.files ?? [])) emit('upload', f)
  input.value = ''
}
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '')
</script>

<template>
  <section class="ik-deviation" :class="deviation.status">
    <header class="ik-deviation-head">
      <UIcon name="i-lucide-triangle-alert" />
      <strong>Avvikelse</strong>
      <InspectionsStatusBadge :status="deviation.status" deviation />
      <span class="spacer" />
      <span class="ik-muted">{{ deviation.reported_by_name }} · {{ fmt(deviation.created_at) }}</span>
    </header>
    <p class="ik-deviation-desc">{{ deviation.description }}</p>

    <div class="ik-deviation-meta">
      <template v-if="reviewer && editable && deviation.status !== 'verified'">
        <label>Ansvarig
          <select :value="deviation.responsible_user_id ?? ''" @change="emit('update', { responsible_user_id: Number(($event.target as HTMLSelectElement).value) || null })">
            <option value="">–</option>
            <option v-for="u in responsibleOptions" :key="u.id" :value="u.id">{{ u.username }}</option>
          </select>
        </label>
        <label>Sista datum
          <input type="date" :value="deviation.due_date ?? ''" @change="emit('update', { due_date: ($event.target as HTMLInputElement).value || null })">
        </label>
      </template>
      <template v-else>
        <span>Ansvarig: {{ deviation.responsible_name || '–' }}</span>
        <span v-if="deviation.due_date">Sista datum: {{ deviation.due_date }}</span>
      </template>
    </div>

    <p v-if="deviation.reopen_reason && deviation.status === 'open'" class="ik-note">Återöppnad: {{ deviation.reopen_reason }}</p>

    <div v-if="deviation.status === 'open' && editable" class="ik-field">
      <span class="ik-field-label">Åtgärd</span>
      <textarea v-model="action" rows="2" placeholder="Beskriv vad som har gjorts" />
      <div class="ik-deviation-actions">
        <button type="button" class="plain primary emp-btn" :disabled="!action.trim()" @click="emit('resolve', action.trim())">Markera åtgärdad</button>
      </div>
    </div>
    <p v-else-if="deviation.action_description" class="ik-deviation-action">
      <strong>Åtgärd:</strong> {{ deviation.action_description }}
      <span v-if="deviation.resolved_at" class="ik-muted"> – {{ deviation.resolved_by_name }}, {{ fmt(deviation.resolved_at) }}</span>
    </p>
    <p v-if="deviation.status === 'verified'" class="ik-muted">Verifierad av {{ deviation.verified_by_name }}, {{ fmt(deviation.verified_at) }}</p>

    <InspectionsPhotoGrid :photos="deviation.photos" :base="photoBase" :can-remove="editable && deviation.status !== 'verified'" @remove="emit('removePhoto', $event)" />
    <div v-if="editable && deviation.status !== 'verified'" class="ik-photo-actions">
      <button v-if="storageConfigured" type="button" class="plain emp-btn" :disabled="uploadingCount > 0" @click="fileInput?.click()">
        <UIcon name="i-lucide-camera" /> Foto på åtgärd
      </button>
      <span v-if="uploadingCount" class="ik-saving">Laddar upp…</span>
      <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="onFiles">
    </div>

    <div v-if="reviewer && editable" class="ik-deviation-actions">
      <button v-if="deviation.status === 'resolved'" type="button" class="plain primary" @click="emit('verify')">Verifiera åtgärd</button>
      <button v-if="deviation.status !== 'open' && !showReopen" type="button" class="plain" @click="showReopen = true">Återöppna</button>
      <button v-if="!deviation.task_id" type="button" class="plain ghost" @click="emit('task')">Skapa uppgift</button>
      <span v-else class="ik-muted">Kopplad till uppgift</span>
    </div>
    <div v-if="showReopen" class="ik-field">
      <span class="ik-field-label">Motivering till återöppning *</span>
      <textarea v-model="reason" rows="2" />
      <div class="ik-deviation-actions">
        <button type="button" class="plain ghost" @click="showReopen = false">Avbryt</button>
        <button type="button" class="plain danger" :disabled="!reason.trim()" @click="emit('reopen', reason.trim())">Återöppna</button>
      </div>
    </div>
  </section>
</template>
