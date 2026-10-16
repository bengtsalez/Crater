<script setup lang="ts">
// "Hämta ÄTA": projektets ÄTA från ÄTA-registret. Endast godkända och ännu
// inte hämtade poster kan väljas. Varje vald ÄTA blir en egen faktureringsdel.
import { ATA_STATUS_LABELS, formatOre, PART_STATUS_LABELS } from '../../../shared/billing'
import type { AtaCandidate } from '../../../shared/billingTypes'

const props = defineProps<{ projectId: number }>()
const open = defineModel<boolean>('open', { required: true })
const { mutate } = useProjectBilling()
const { api } = useApi()
const toast = useToast()
const isMobile = useIsMobile()

const items = ref<AtaCandidate[]>([])
const selected = ref<number[]>([])
const loading = ref(false)
const saving = ref(false)

watch(open, async (v) => {
  if (!v) return
  selected.value = []
  loading.value = true
  try {
    items.value = await api<AtaCandidate[]>('GET', `/api/projects/${props.projectId}/billing/ata`)
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    loading.value = false
  }
})

const selectable = (a: AtaCandidate) => a.ata_status === 'godkand' && a.part_id === null

async function importSelected() {
  if (!selected.value.length) return
  saving.value = true
  try {
    const res = await mutate<{ created: number[]; skipped: number[] }>('POST', `/api/projects/${props.projectId}/billing/ata-import`, {
      ids: selected.value,
    })
    toast.add({
      title: `${res.created.length} ÄTA hämtade${res.skipped.length ? `, ${res.skipped.length} var redan hämtade` : ''}`,
      color: 'success',
    })
    open.value = false
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :fullscreen="isMobile" title="Hämta ÄTA" :ui="{ content: 'sm:max-w-3xl' }">
    <template #body>
      <div class="pp-form">
        <p class="hint">Endast godkända ÄTA kan hämtas. Godkänn en ÄTA under projektets översikt (ÄTA-arbeten).</p>
        <table class="data-table">
          <thead><tr><th /><th>Beskrivning</th><th>Datum</th><th class="num">Belopp</th><th>Status</th><th>Fakturering</th></tr></thead>
          <tbody>
            <tr v-if="loading"><td colspan="6" class="empty-state">Laddar…</td></tr>
            <tr v-else-if="!items.length"><td colspan="6" class="empty-state">Projektet har inga ÄTA.</td></tr>
            <tr v-for="a in items" :key="a.id" :class="{ 'bl-locked': !selectable(a) }">
              <td data-label="">
                <input v-model="selected" type="checkbox" :value="a.id" :disabled="!selectable(a)" :aria-label="`Välj ${a.description}`">
              </td>
              <td data-label="Beskrivning">{{ a.description }}</td>
              <td data-label="Datum">{{ a.date || '–' }}</td>
              <td data-label="Belopp" class="num">{{ formatOre(Math.round(a.amount * 100)) }}</td>
              <td data-label="Status"><span class="badge" :class="'ata-' + a.ata_status">{{ ATA_STATUS_LABELS[a.ata_status] }}</span></td>
              <td data-label="Fakturering">
                <template v-if="a.part_id">
                  {{ a.part_status === 'fakturerad' || a.part_status === 'betald' ? 'Fakturerad' : 'Hämtad' }}
                  ({{ a.document_number }}<template v-if="a.part_status">, {{ PART_STATUS_LABELS[a.part_status] }}</template>)
                </template>
                <span v-else class="hint">Ej hämtad</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="modal-actions">
          <div class="spacer" />
          <button type="button" class="plain ghost" @click="open = false">Avbryt</button>
          <button type="button" class="plain primary" :disabled="!selected.length || saving" @click="importSelected">
            Hämta {{ selected.length || '' }} ÄTA
          </button>
        </div>
      </div>
    </template>
  </UModal>
</template>
