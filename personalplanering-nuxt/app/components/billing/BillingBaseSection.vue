<script setup lang="ts">
// Steg 1: fakturaposterna. Grundavtalets totalsumma = posternas summa inkl. moms.
import { formatOre, lineItems, summarize, isLockedStatus } from '../../../shared/billing'
import type { ProjectBillingView } from '../../../shared/billingTypes'
import { draftPayload, draftToCalc, percentInput, toDraft, type DraftLine } from '~/utils/billingDraft'

const props = defineProps<{ view: ProjectBillingView; projectId: number }>()
const { mutate, priceMode } = useProjectBilling()
const toast = useToast()

const lines = ref<DraftLine[]>([])
const saving = ref(false)

const lockedLineIds = computed(() => {
  const locked = new Set(props.view.parts.filter((p) => isLockedStatus(p.status)).map((p) => p.id))
  return new Set(props.view.allocations.filter((a) => locked.has(a.part_id) && a.amount_ex_ore !== 0).map((a) => a.line_id))
})
function reset() {
  lines.value = props.view.base_lines.map((l) => toDraft(l, priceMode.value, lockedLineIds.value.has(l.id)))
}
watch(() => props.view.base_lines, reset, { immediate: true })

const dirty = computed(
  () => JSON.stringify(lines.value.map(draftPayload)) !== JSON.stringify(props.view.base_lines.map((l) => draftPayload(toDraft(l, 'ex'))))
)
const amounts = computed(() => summarize(lineItems(lines.value.map(draftToCalc))))

async function save() {
  saving.value = true
  try {
    await mutate('PUT', `/api/projects/${props.projectId}/billing/lines`, { lines: lines.value.map(draftPayload) })
    // En ROT-markerad post slår på ROT för projektet.
    if (lines.value.some((l) => l.rot_eligible) && !props.view.settings.rot_enabled) {
      await mutate('PUT', `/api/projects/${props.projectId}/billing`, { rot_enabled: true })
    }
    toast.add({ title: 'Posterna sparade', color: 'success' })
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}

// ---- ROT och fastighet (hopfällt) ----
const settings = reactive({
  rot_enabled: false,
  rot_rate: '30',
  property_designation: '',
  housing_type: '' as '' | 'villa' | 'brf',
  brf_name: '',
  brf_org_number: '',
  apartment_number: '',
})
const settingsOpen = ref(false)
const savingSettings = ref(false)
function resetSettings() {
  const s = props.view.settings
  Object.assign(settings, {
    rot_enabled: s.rot_enabled,
    rot_rate: percentInput(s.rot_rate_bp),
    property_designation: s.property_designation ?? '',
    housing_type: s.housing_type ?? '',
    brf_name: s.brf_name ?? '',
    brf_org_number: s.brf_org_number ?? '',
    apartment_number: s.apartment_number ?? '',
  })
}
watch(() => props.view.settings, resetSettings, { immediate: true })
async function saveSettings() {
  savingSettings.value = true
  try {
    await mutate('PUT', `/api/projects/${props.projectId}/billing`, { ...settings, housing_type: settings.housing_type || null })
    toast.add({ title: 'Sparat', color: 'success' })
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    savingSettings.value = false
  }
}
</script>

<template>
  <section class="billing-section">
    <div class="billing-step">
      <span class="billing-step-num">1</span>
      <h3>Fakturaposter</h3>
      <div class="spacer" />
      <div class="seg" role="group" aria-label="Prisläge">
        <button type="button" class="seg-btn" :class="{ active: priceMode === 'ex' }" @click="priceMode = 'ex'">Exkl. moms</button>
        <button type="button" class="seg-btn" :class="{ active: priceMode === 'inc' }" @click="priceMode = 'inc'">Inkl. moms</button>
      </div>
    </div>

    <BillingLinesEditor v-model="lines" :mode="priceMode" />

    <div class="billing-totals">
      <span>Exkl. moms <strong>{{ formatOre(amounts.ex_ore) }}</strong></span>
      <span>Moms <strong>{{ formatOre(amounts.vat_ore) }}</strong></span>
      <span class="billing-total">Totalt <strong>{{ formatOre(amounts.inc_ore) }}</strong></span>
      <div class="spacer" />
      <button v-if="dirty" type="button" class="plain ghost" @click="reset">Ångra</button>
      <button type="button" class="plain primary" :disabled="saving || !dirty" @click="save">Spara poster</button>
    </div>

    <button type="button" class="link-button billing-collapse" @click="settingsOpen = !settingsOpen">
      {{ settingsOpen ? '▾' : '▸' }} ROT och fastighet
      <span v-if="view.settings.rot_enabled" class="hint">· ROT {{ percentInput(view.settings.rot_rate_bp) }} %</span>
    </button>
    <form v-if="settingsOpen" class="pp-form billing-form" @submit.prevent="saveSettings">
      <div class="row-2">
        <label class="checkbox-label"><input v-model="settings.rot_enabled" type="checkbox"> ROT-avdrag</label>
        <label>ROT-procent<input v-model="settings.rot_rate" inputmode="decimal" :disabled="!settings.rot_enabled"></label>
        <label>Fastighetsbeteckning<input v-model="settings.property_designation" maxlength="200"></label>
        <label>Bostadstyp
          <select v-model="settings.housing_type">
            <option value="">–</option>
            <option value="villa">Småhus</option>
            <option value="brf">Bostadsrätt</option>
          </select>
        </label>
      </div>
      <div v-if="settings.housing_type === 'brf'" class="row-2">
        <label>Förening<input v-model="settings.brf_name" maxlength="200"></label>
        <label>Föreningens org.nr<input v-model="settings.brf_org_number" maxlength="20"></label>
        <label>Lägenhetsnr<input v-model="settings.apartment_number" maxlength="20"></label>
      </div>
      <div class="modal-actions">
        <div class="spacer" />
        <button type="submit" class="plain primary" :disabled="savingSettings">Spara</button>
      </div>
    </form>
  </section>
</template>
