<script setup lang="ts">
import { INSPECTION_KIND_LABELS, INSPECTION_STATUS_LABELS, type AnswerValue, type TemplateSection } from '../../../shared/inspections'
import type { DeviationView, InspectionItemView } from '../../../shared/inspectionTypes'

// Ifyllnad och granskning av en kontroll. Samma komponent används i den
// interna vyn (base=/api/inspections/:id) och i personalvyn
// (base=/api/employee/inspections/:id). Servern avgör vad som är tillåtet –
// `view.can` styr bara vilka knappar som visas.
const props = defineProps<{ base: string; mode: 'internal' | 'employee' }>()
const emit = defineEmits<{ changed: []; openRevision: [id: number] }>()

const insp = useInspection(() => props.base)
const { view, pending, loadError, notFound, busy, itemState, uploading, uploadKey } = insp
const toast = useToast()
const isMobile = useIsMobile()
const { users } = useAppData()

watch(() => props.base, () => {
  pending.value = true
  insp.load()
}, { immediate: true })

const sections = computed(() => {
  const out: { title: string; items: { item: InspectionItemView; n: number }[] }[] = []
  let n = 0
  for (const it of view.value?.items ?? []) {
    n++
    const last = out.at(-1)
    if (last && last.title === it.section_title) last.items.push({ item: it, n })
    else out.push({ title: it.section_title, items: [{ item: it, n }] })
  }
  return out
})

function deviationFor(itemId: number): DeviationView | null {
  const devs = (view.value?.deviations ?? []).filter((d) => d.item_id === itemId)
  return devs.find((d) => d.status !== 'verified') ?? devs.at(-1) ?? null
}

const reviewer = computed(() => props.mode === 'internal')
const locked = computed(() => !!view.value && (!view.value.can.answer || view.value.superseded_by_id !== null))
const deviationEditable = computed(
  () => !!view.value && view.value.superseded_by_id === null && !['approved', 'archived'].includes(view.value.status)
)
const responsibleOptions = computed(() =>
  users.value.filter((u) => u.active !== false && (u.role === 'admin' || u.role === 'member' || u.role === 'employee'))
)
const criticalCount = computed(() => view.value?.items.filter((i) => i.critical && !i.evaluation.complete).length ?? 0)
const submitError = ref('')

async function onSave(item: InspectionItemView, value: Partial<AnswerValue>) {
  if (await insp.saveAnswer(item, value)) emit('changed')
}
async function onUpload(target: { item_id?: number; deviation_id?: number }, file: File) {
  const err = await insp.uploadPhoto(target, file)
  if (err) toast.add({ title: err, color: 'error' })
  else emit('changed')
}
async function onRemovePhoto(id: string) {
  const err = await insp.removePhoto(id)
  if (err) toast.add({ title: err, color: 'error' })
}

async function run(method: 'POST' | 'PUT', path: string, body?: unknown, success?: string) {
  try {
    await insp.mutate(method, path, body)
    if (success) toast.add({ title: success, color: 'success' })
    emit('changed')
    return true
  } catch (err) {
    const e = err as ApiError
    toast.add({ title: e.message, color: 'error' })
    if (e.code === 'conflict' || e.code === 'invalid_transition' || e.code === 'superseded') await insp.load()
    return false
  }
}

async function submit() {
  submitError.value = ''
  const path = props.mode === 'employee' ? '/submit' : '/transition'
  try {
    await insp.mutate('POST', path, props.mode === 'employee' ? {} : { action: 'submit' })
    toast.add({ title: 'Kontrollen är inlämnad för granskning', color: 'success' })
    emit('changed')
  } catch (err) {
    const e = err as ApiError
    submitError.value = e.message
    if (e.status === 409) await insp.load()
  }
}

// ---- Granskningsdialog ----
type Dialog = 'request_changes' | 'approve' | 'archive' | 'revision' | 'meta' | 'items' | null
const dialog = ref<Dialog>(null)
const comment = ref('')
const metaForm = reactive({ name: '', location: '', due_date: '', responsible_user_id: '' as string | number })
const itemsDraft = ref<TemplateSection[]>([])

function openDialog(d: Dialog) {
  comment.value = ''
  if (d === 'meta' && view.value) {
    Object.assign(metaForm, {
      name: view.value.name,
      location: view.value.location ?? '',
      due_date: view.value.due_date ?? '',
      responsible_user_id: view.value.responsible_user_id ?? '',
    })
  }
  if (d === 'items' && view.value) {
    itemsDraft.value = sections.value.map((s) => ({
      title: s.title,
      items: s.items.map(({ item: it }) => ({
        key: it.item_key, title: it.title, instruction: it.instruction, basis: it.basis, basis_url: it.basis_url,
        method: it.method, answer_type: it.answer_type, unit: it.unit, required: it.required, min_photos: it.min_photos,
        comment_required: it.comment_required, critical: it.critical, timing_note: it.timing_note,
      })),
    }))
  }
  dialog.value = d
}

async function confirmDialog() {
  const v = view.value
  if (!v) return
  let ok = false
  if (dialog.value === 'request_changes' || dialog.value === 'approve' || dialog.value === 'archive') {
    const labels = { request_changes: 'Komplettering begärd', approve: 'Kontrollen är godkänd', archive: 'Kontrollen är arkiverad' }
    ok = await run('POST', '/transition', { action: dialog.value, comment: comment.value || null, lock_version: v.lock_version }, labels[dialog.value])
  } else if (dialog.value === 'revision') {
    try {
      const res = await insp.mutate('POST', '/revision', { reason: comment.value, lock_version: v.lock_version })
      toast.add({ title: 'Ny revision skapad', color: 'success' })
      emit('changed')
      emit('openRevision', (res as { id: number }).id)
      ok = true
    } catch (err) {
      toast.add({ title: (err as Error).message, color: 'error' })
    }
  } else if (dialog.value === 'meta') {
    ok = await run('PUT', '', {
      name: metaForm.name,
      location: metaForm.location || null,
      due_date: metaForm.due_date || null,
      responsible_user_id: metaForm.responsible_user_id || null,
      lock_version: v.lock_version,
    }, 'Uppgifterna sparade')
  } else if (dialog.value === 'items') {
    ok = await run('PUT', '/items', { sections: itemsDraft.value, lock_version: v.lock_version }, 'Punkterna sparade')
  }
  if (ok) dialog.value = null
}

const dialogTitle = computed(
  () =>
    ({
      request_changes: 'Begär komplettering',
      approve: 'Godkänn kontrollen',
      archive: 'Arkivera kontrollen',
      revision: 'Ny revision',
      meta: 'Uppgifter om kontrollen',
      items: 'Anpassa frågor och krav',
    })[dialog.value ?? 'meta']
)

async function pdf() {
  try {
    await insp.downloadPdf()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '')
const EVENT_LABELS: Record<string, string> = {
  created: 'Skapad',
  started: 'Påbörjad',
  submitted: 'Inlämnad',
  changes_requested: 'Komplettering begärd',
  approved: 'Godkänd',
  archived: 'Arkiverad',
  revision_created: 'Ny revision skapad',
  superseded: 'Ersatt av ny revision',
  items_customized: 'Punkter anpassade',
}

defineExpose({ reload: insp.load })
</script>

<template>
  <div class="ik-form">
    <p v-if="pending && !view" class="empty-state">Laddar kontrollen…</p>
    <div v-else-if="notFound" class="emp-notice" role="alert">
      <h2>Kontrollen kunde inte visas</h2>
      <p>Kontrollen finns inte eller är inte tilldelad dig.</p>
    </div>
    <p v-else-if="loadError && !view" class="emp-error" role="alert">{{ loadError }} <button class="plain" @click="insp.load()">Försök igen</button></p>

    <template v-else-if="view">
      <header class="ik-head">
        <div class="ik-head-main">
          <span class="ik-kind">{{ INSPECTION_KIND_LABELS[view.kind] }}<template v-if="mode === 'internal'"> · {{ view.project.project_number }} {{ view.project.name }}</template></span>
          <h2 class="ik-title">{{ view.name }}<span v-if="view.location" class="ik-location"> – {{ view.location }}</span></h2>
          <div class="ik-head-meta">
            <InspectionsStatusBadge :status="view.status" />
            <span>Rev {{ view.revision }} · mall v{{ view.template_version }}</span>
            <span>Ansvarig: {{ view.responsible_name || '–' }}</span>
            <span v-if="view.due_date">Sista datum: {{ view.due_date }}</span>
          </div>
          <InspectionsCoverageBar :coverage="view.coverage" />
          <p v-if="view.open_deviations" class="ik-warn-text"><UIcon name="i-lucide-triangle-alert" /> {{ view.open_deviations }} {{ view.open_deviations === 1 ? 'avvikelse' : 'avvikelser' }} inte verifierade</p>
        </div>
        <div class="ik-head-actions">
          <button class="plain" @click="pdf"><UIcon name="i-lucide-file-down" /> PDF</button>
          <template v-if="view.can.manage && view.superseded_by_id === null">
            <button v-if="!['approved', 'archived'].includes(view.status)" class="plain" @click="openDialog('meta')">Redigera uppgifter</button>
            <button v-if="view.can.edit_items" class="plain" @click="openDialog('items')">Anpassa punkter</button>
          </template>
        </div>
      </header>

      <div v-if="view.superseded_by_id" class="ik-notice">
        Det här är revision {{ view.revision }} och har ersatts av en nyare revision. Innehållet är bevarat och skrivskyddat.
        <button v-if="mode === 'internal'" class="link-button" @click="emit('openRevision', view.superseded_by_id!)">Öppna senaste revisionen</button>
      </div>
      <div v-if="view.revisions.length > 1 && mode === 'internal'" class="ik-revisions">
        Revisioner:
        <button v-for="r in view.revisions" :key="r.id" class="link-button" :class="{ current: r.id === view.id }" @click="emit('openRevision', r.id)">
          {{ r.revision }} ({{ INSPECTION_STATUS_LABELS[r.status] }})
        </button>
      </div>
      <p v-if="view.revision_reason" class="ik-note">Orsak till revision {{ view.revision }}: {{ view.revision_reason }}</p>
      <div v-if="view.status === 'changes_requested' && view.review_comment" class="ik-notice warn" role="status">
        <strong>Komplettering krävs:</strong> {{ view.review_comment }}
      </div>
      <div v-if="view.status === 'submitted'" class="ik-notice">
        Inlämnad {{ fmt(view.submitted_at) }} av {{ view.submitted_by_name }} – väntar på granskning. Svar kan inte ändras förrän kontrollen återlämnas.
      </div>
      <div v-if="view.status === 'approved'" class="ik-notice ok">
        Godkänd {{ fmt(view.approved_at) }} av {{ view.approved_by_name }}<template v-if="view.approval_comment">: {{ view.approval_comment }}</template>. Innehållet är låst.
      </div>
      <div v-if="!view.storage_configured && view.can.answer && view.items.some((i) => i.min_photos)" class="ik-notice warn" role="alert">
        Bildlagring är inte konfigurerad. Punkter som kräver foto kan inte bli klara förrän administratören har konfigurerat lagringen.
      </div>
      <div v-if="criticalCount && view.can.answer" class="ik-critical" role="note">
        <UIcon name="i-lucide-triangle-alert" />
        <span>{{ criticalCount }} kritiska moment återstår – kontrollera dem innan arbetet går vidare.</span>
      </div>

      <section v-for="(s, si) in sections" :key="si" class="ik-section">
        <h3 v-if="s.title" class="ik-section-title">{{ s.title }}</h3>
        <InspectionsItemCard
          v-for="{ item, n } in s.items"
          :key="item.id"
          :item="item"
          :index="n"
          :can-answer="view.can.answer"
          :state="itemState[item.id]"
          :uploading-count="uploading[uploadKey({ item_id: item.id })] ?? 0"
          :storage-configured="view.storage_configured"
          :photo-base="base"
          :deviation="deviationFor(item.id)"
          @save="onSave(item, $event)"
          @upload="onUpload({ item_id: item.id }, $event)"
          @remove-photo="onRemovePhoto"
          @reload="insp.load()"
        >
          <template #deviation="{ deviation }">
            <InspectionsDeviationPanel
              v-if="deviation"
              :deviation="deviation"
              :reviewer="reviewer"
              :editable="deviationEditable"
              :photo-base="base"
              :storage-configured="view.storage_configured"
              :uploading-count="uploading[uploadKey({ deviation_id: deviation.id })] ?? 0"
              :responsible-options="responsibleOptions"
              @resolve="run('POST', `/deviations/${deviation.id}/resolve`, { action_description: $event, rev: deviation.rev }, 'Åtgärden är dokumenterad')"
              @verify="run('POST', `/deviations/${deviation.id}/verify`, { rev: deviation.rev }, 'Avvikelsen är verifierad')"
              @reopen="run('POST', `/deviations/${deviation.id}/reopen`, { reason: $event, rev: deviation.rev }, 'Avvikelsen är återöppnad')"
              @update="run('PUT', `/deviations/${deviation.id}`, { ...$event, rev: deviation.rev })"
              @task="run('POST', `/deviations/${deviation.id}/task`, undefined, 'Uppgift skapad och kopplad')"
              @upload="onUpload({ deviation_id: deviation.id }, $event)"
              @remove-photo="onRemovePhoto"
            />
          </template>
        </InspectionsItemCard>
      </section>

      <div class="ik-footer-actions">
        <p v-if="submitError" class="ik-save-error" role="alert">{{ submitError }}</p>
        <button v-if="view.can.submit" class="plain primary emp-btn ik-big" :disabled="busy" @click="submit">
          {{ view.status === 'changes_requested' ? 'Lämna in kompletteringen' : 'Lämna in för granskning' }}
        </button>
        <template v-if="mode === 'internal' && view.superseded_by_id === null">
          <button v-if="view.can.review" class="plain primary" :disabled="busy" @click="openDialog('approve')">Godkänn</button>
          <button v-if="view.can.review" class="plain" :disabled="busy" @click="openDialog('request_changes')">Begär komplettering</button>
          <button v-if="view.can.revise" class="plain" :disabled="busy" @click="openDialog('revision')">Ny revision</button>
          <button v-if="view.status !== 'archived'" class="plain ghost" :disabled="busy" @click="openDialog('archive')">Arkivera</button>
        </template>
      </div>
      <p v-if="locked && mode === 'employee' && view.status !== 'submitted'" class="ik-muted">Kontrollen är skrivskyddad.</p>

      <details class="ik-history">
        <summary>Historik ({{ view.events.length }})</summary>
        <ul>
          <li v-for="e in view.events" :key="e.id">
            <span class="ik-muted">{{ fmt(e.created_at) }}</span> {{ EVENT_LABELS[e.event_type] || e.event_type }} – {{ e.user_name || 'system' }}<template v-if="e.comment">: {{ e.comment }}</template>
          </li>
        </ul>
      </details>

      <UModal :open="!!dialog" :fullscreen="isMobile" :title="dialogTitle" :ui="dialog === 'items' ? { content: 'sm:max-w-3xl' } : undefined" @update:open="(v: boolean) => { if (!v) dialog = null }">
        <template #body>
          <form class="pp-form" @submit.prevent="confirmDialog">
            <template v-if="dialog === 'meta'">
              <label>Namn *<input v-model="metaForm.name" required maxlength="200"></label>
              <div class="row-2">
                <label>Plats eller etapp<input v-model="metaForm.location" maxlength="200" placeholder="t.ex. Norrsida, balkong 3"></label>
                <label>Sista datum<input v-model="metaForm.due_date" type="date"></label>
              </div>
              <label>Huvudansvarig
                <select v-model="metaForm.responsible_user_id">
                  <option value="">–</option>
                  <option v-for="u in responsibleOptions" :key="u.id" :value="u.id">{{ u.username }}{{ u.role === 'employee' ? ' (personal)' : '' }}</option>
                </select>
              </label>
            </template>
            <template v-else-if="dialog === 'items'">
              <p class="hint">Anpassningen gäller bara den här kontrollen. När arbetet har påbörjats ändras frågor genom en ny revision.</p>
              <InspectionsSectionsEditor v-model="itemsDraft" />
            </template>
            <template v-else>
              <p v-if="dialog === 'approve'" class="hint">Godkännandet registreras med ditt konto och tidpunkt och låser innehållet.</p>
              <p v-if="dialog === 'revision'" class="hint">
                Den nuvarande versionen bevaras oförändrad{{ view.status === 'approved' ? ' (även dess PDF)' : '' }}. Den nya revisionen får kopior av svar och bilder och kan ändras.
              </p>
              <label>
                {{ dialog === 'request_changes' ? 'Vad saknas? *' : dialog === 'revision' ? 'Orsak till revisionen *' : 'Kommentar' }}
                <textarea v-model="comment" rows="3" :required="dialog === 'request_changes' || dialog === 'revision'" />
              </label>
            </template>
            <div class="modal-actions">
              <div class="spacer" />
              <button type="button" class="plain ghost" @click="dialog = null">Avbryt</button>
              <button type="submit" class="plain primary" :disabled="busy">
                {{ dialog === 'approve' ? 'Godkänn' : dialog === 'archive' ? 'Arkivera' : dialog === 'revision' ? 'Skapa revision' : dialog === 'request_changes' ? 'Skicka' : 'Spara' }}
              </button>
            </div>
          </form>
        </template>
      </UModal>
    </template>
  </div>
</template>
