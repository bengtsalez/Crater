<script setup lang="ts">
// En faktureringsdel: rader, summering, manuellt ROT, status, betalningar, PDF.
import {
  allocatedQuantity,
  formatOre,
  formatPercentBp,
  LINE_TYPE_LABELS,
  lineItems,
  maxRot,
  normalizePersonnummer,
  PART_KIND_LABELS,
  PART_STATUS_LABELS,
  ROT_STATUS_LABELS,
  summarize,
  kronorToOre,
  displayPrice,
  formatPersonnummer,
  type RotStatus,
} from '../../../shared/billing'
import type { BillingPart, ProjectBillingView } from '../../../shared/billingTypes'
import { draftPayload, draftToCalc, newDraft, oreToInput, percentInput, setPriceText, toDraft, type DraftLine } from '~/utils/billingDraft'

const props = defineProps<{ view: ProjectBillingView; partId: number | null }>()
const emit = defineEmits<{ close: []; openPart: [id: number] }>()
const open = computed({
  get: () => props.partId !== null,
  set: (v) => {
    if (!v) emit('close')
  },
})
const { mutate, priceMode, downloadPdf } = useProjectBilling()
const { api } = useApi()
const toast = useToast()
const isMobile = useIsMobile()

const part = computed<BillingPart | null>(() => props.view.parts.find((p) => p.id === props.partId) ?? null)
const result = computed(() => (part.value ? props.view.calc.parts[part.value.id] : null))
const blocking = computed(() => {
  if (!part.value || !result.value) return []
  return part.value.kind === 'installment' ? [...props.view.calc.base_errors, ...result.value.errors] : result.value.errors
})
const rotAvailable = computed(() => props.view.settings.rot_enabled && part.value?.kind !== 'correction')

// ---- Formulär (öppen del) ----
const form = reactive({ name: '', planned_date: '', milestone: '', rot_rate: '' })
const lines = ref<DraftLine[]>([])
const recipients = ref<{ position: number; name: string; personnummer: string; amount: string }[]>([])
const meta = reactive({ notes: '', external_invoice_ref: '' })
const invoiceForm = reactive({ invoiced_date: new Date().toISOString().slice(0, 10), external_invoice_ref: '' })
const payments = reactive({
  customer_paid: '',
  customer_paid_date: '',
  rot_status: 'ej_sokt' as RotStatus,
  rot_applied: '',
  rot_applied_date: '',
  rot_paid: '',
  rot_paid_date: '',
})
const busy = ref(false)

async function resetForm() {
  const p = part.value
  if (!p) return
  Object.assign(form, { name: p.name, planned_date: p.planned_date ?? '', milestone: p.milestone ?? '', rot_rate: percentInput(p.rot_rate_bp) })
  lines.value = p.lines.map((l) => toDraft(l, priceMode.value))
  Object.assign(meta, { notes: p.notes ?? '', external_invoice_ref: p.external_invoice_ref ?? '' })
  invoiceForm.external_invoice_ref = p.external_invoice_ref ?? ''
  Object.assign(payments, {
    customer_paid: oreToInput(p.customer_paid_ore),
    customer_paid_date: p.customer_paid_date ?? '',
    rot_status: p.rot_status,
    rot_applied: oreToInput(p.rot_applied_ore),
    rot_applied_date: p.rot_applied_date ?? '',
    rot_paid: oreToInput(p.rot_paid_ore),
    rot_paid_date: p.rot_paid_date ?? '',
  })
  recipients.value = p.rot_recipients.map((r) => ({ position: r.position, name: r.name ?? '', personnummer: '', amount: oreToInput(r.amount_ore) }))
  // Personnummer i klartext hämtas bara för redigering av en öppen del.
  if (!p.locked && rotAvailable.value) {
    try {
      const res = await api<{ rot_recipients: { position: number; personnummer: string }[] }>('GET', `/api/billing/parts/${p.id}`)
      for (const r of res.rot_recipients) {
        const target = recipients.value.find((x) => x.position === r.position)
        if (target) target.personnummer = r.personnummer ? formatPersonnummer(r.personnummer) : ''
      }
    } catch (err) {
      toast.add({ title: (err as Error).message, color: 'error' })
    }
  }
}
watch(() => props.partId, (id) => id && resetForm(), { immediate: true })

// Live-beräkning för öppna ÄTA-/korrigeringsdelar (rader i formuläret).
const liveAmounts = computed(() => {
  if (!part.value || !result.value) return null
  if (part.value.kind === 'installment' || part.value.locked) return result.value.amounts
  return summarize(lineItems(lines.value.map(draftToCalc)))
})
const liveRateBp = computed(() => {
  const n = Number(String(form.rot_rate).replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : part.value?.rot_rate_bp ?? 0
})
const liveMaxRot = computed(() => {
  if (!part.value || !result.value) return 0
  if (part.value.locked) return result.value.max_rot_ore
  return rotAvailable.value && liveAmounts.value ? maxRot(liveAmounts.value.rot_basis_inc_ore, liveRateBp.value) : 0
})
const liveRotTotal = computed(() =>
  part.value?.locked ? result.value!.rot_total_ore : rotAvailable.value ? recipients.value.reduce((s, r) => s + (kronorToOre(r.amount || '0') ?? 0), 0) : 0
)
const liveToPay = computed(() => (liveAmounts.value ? liveAmounts.value.inc_ore - liveRotTotal.value : 0))
const pnrState = (pnr: string) => (!pnr ? null : normalizePersonnummer(pnr) ? 'ok' : 'bad')

// Delbetalningens rader (skrivskyddade, ur fördelningen).
const installmentLines = computed(() => {
  if (!part.value || part.value.kind !== 'installment') return []
  return props.view.allocations
    .filter((a) => a.part_id === part.value!.id && a.amount_ex_ore !== 0)
    .map((a) => {
      const l = props.view.base_lines.find((x) => x.id === a.line_id)!
      return { key: a.line_id, l, qty: allocatedQuantity(l, a.amount_ex_ore), ex: a.amount_ex_ore }
    })
    .filter((x) => x.l)
})

async function run(fn: () => Promise<unknown>, ok?: string) {
  if (busy.value) return
  busy.value = true
  try {
    await fn()
    if (ok) toast.add({ title: ok, color: 'success' })
    await resetForm()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    busy.value = false
  }
}

function savePart() {
  const p = part.value!
  const body: Record<string, unknown> = {
    name: form.name,
    planned_date: form.planned_date || null,
    milestone: form.milestone,
    notes: meta.notes,
    external_invoice_ref: meta.external_invoice_ref,
  }
  if (p.kind !== 'correction') body.rot_rate = form.rot_rate
  if (p.kind !== 'installment') body.lines = lines.value.map(draftPayload)
  if (rotAvailable.value) {
    body.rot_recipients = recipients.value.map((r) => ({
      position: r.position,
      name: r.name,
      personnummer: r.personnummer,
      amount: r.amount || '0',
    }))
  }
  return run(() => mutate('PUT', `/api/billing/parts/${p.id}`, body), 'Delen sparad')
}

function saveMeta() {
  return run(
    () => mutate('PUT', `/api/billing/parts/${part.value!.id}`, { notes: meta.notes, external_invoice_ref: meta.external_invoice_ref }),
    'Uppgifterna sparade'
  )
}

function setStatus(status: string) {
  const p = part.value!
  if (status === 'fakturerad' && !confirm('Markera som fakturerad? Underlaget låses och en oföränderlig version sparas. Ändringar kräver därefter en korrigering.')) return
  return run(
    () =>
      mutate('POST', `/api/billing/parts/${p.id}/status`, {
        status,
        ...(status === 'fakturerad' ? { invoiced_date: invoiceForm.invoiced_date, external_invoice_ref: invoiceForm.external_invoice_ref } : {}),
      }),
    `Status: ${PART_STATUS_LABELS[status as keyof typeof PART_STATUS_LABELS]}`
  )
}

function savePayments() {
  return run(() => mutate('POST', `/api/billing/parts/${part.value!.id}/payments`, { ...payments }), 'Betalningar sparade')
}

function correction() {
  return run(async () => {
    const res = await mutate<{ id: number }>('POST', `/api/billing/parts/${part.value!.id}/correction`)
    emit('openPart', res.id)
  }, 'Korrigering skapad')
}

function removePart() {
  if (!confirm('Ta bort faktureringsdelen?')) return
  return run(async () => {
    await mutate('DELETE', `/api/billing/parts/${part.value!.id}`)
    emit('close')
  }, 'Delen borttagen')
}

function ackAta() {
  return run(() => mutate('POST', `/api/billing/parts/${part.value!.id}/ata-ack`), 'Avvikelsen bekräftad')
}

function addAtaAmountLine(mode: 'ex' | 'inc') {
  const src = part.value?.ata?.current ?? part.value?.ata?.source
  if (!src) return
  const d = newDraft(priceMode.value, 'ovrigt')
  d.description = src.description
  setPriceText(d, String(src.amount), mode)
  d.price_text = displayPrice(d.unit_price_ex_vat, d.vat_rate_bp, priceMode.value).replace('.', ',')
  lines.value = [...lines.value, d]
}

async function pdf(documentId?: number) {
  const p = part.value!
  try {
    await downloadPdf(
      documentId ? `/api/billing/documents/${documentId}/pdf` : `/api/billing/parts/${p.id}/pdf`,
      `Faktureringsunderlag-${p.document_number}.pdf`
    )
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}
</script>

<template>
  <UModal v-model:open="open" :fullscreen="isMobile" :title="part ? `${part.document_number} – ${part.name}` : ''" :ui="{ content: 'sm:max-w-5xl' }">
    <template #body>
      <div v-if="part && result" class="pp-form billing-part">
        <div class="billing-part-head">
          <span class="badge" :class="'bp-' + part.status">{{ PART_STATUS_LABELS[part.status] }}</span>
          <span>{{ PART_KIND_LABELS[part.kind] }}</span>
          <span v-if="part.percent_bp !== null">· {{ formatPercentBp(part.percent_bp) }} av grundavtalet</span>
          <span v-if="part.corrects_document_number">· korrigerar {{ part.corrects_document_number }}</span>
          <span v-if="part.locked" class="hint">· Låst {{ part.invoiced_date }}</span>
          <div class="spacer" />
          <button type="button" class="plain ghost" @click="pdf()">{{ part.locked ? 'PDF' : 'PDF (utkast)' }}</button>
        </div>

        <ul v-if="blocking.length && !part.locked" class="billing-errors">
          <li v-for="e in blocking" :key="e">{{ e }}</li>
        </ul>
        <ul v-if="result.warnings.length && !part.locked" class="billing-warnings">
          <li v-for="w in result.warnings" :key="w">{{ w }}</li>
        </ul>

        <!-- ÄTA-koppling -->
        <div v-if="part.ata" class="billing-ata-ref">
          <div>
            <strong>ÄTA:</strong> {{ part.ata.source?.description }} · {{ formatOre(Math.round((part.ata.source?.amount ?? 0) * 100)) }} enligt ÄTA-registret
            <span v-if="part.ata.source?.date" class="hint">({{ part.ata.source.date }})</span>
          </div>
          <div v-if="part.ata.deviation" class="billing-errors">
            ÄTA:n har ändrats till "{{ part.ata.current?.description }}" {{ formatOre(Math.round((part.ata.current?.amount ?? 0) * 100)) }}.
            <button type="button" class="plain ghost" :disabled="busy" @click="ackAta">Bekräfta avvikelse</button>
          </div>
          <div v-if="!part.locked && !lines.length" class="hint">
            Specificera posterna nedan, eller lägg in beloppet som en rad:
            <button type="button" class="link-button" @click="addAtaAmountLine('ex')">exkl. moms</button>
            ·
            <button type="button" class="link-button" @click="addAtaAmountLine('inc')">inkl. moms</button>
          </div>
        </div>

        <template v-if="!part.locked">
          <div class="row-2">
            <label>Namn<input v-model="form.name" maxlength="200"></label>
            <label>Planerat faktureringsdatum<input v-model="form.planned_date" type="date"></label>
            <label>Milstolpe<input v-model="form.milestone" maxlength="200"></label>
          </div>
          <div class="row-2">
            <label>Fortnox fakturanr<input v-model="meta.external_invoice_ref" maxlength="100"></label>
            <label>Anteckning<input v-model="meta.notes" maxlength="2000"></label>
          </div>
        </template>

        <h4 class="billing-subtitle">Poster</h4>
        <template v-if="part.kind === 'installment'">
          <table class="data-table">
            <thead><tr><th>Beskrivning</th><th>Typ</th><th class="num">Antal</th><th>Enhet</th><th class="num">À-pris exkl. moms</th><th class="num">Summa exkl. moms</th></tr></thead>
            <tbody>
              <tr v-if="!installmentLines.length"><td colspan="6" class="empty-state">Inga fördelade rader.</td></tr>
              <tr v-for="x in installmentLines" :key="x.key">
                <td data-label="Beskrivning">{{ x.l.description }}<span v-if="x.l.rot_eligible" class="hint"> (ROT)</span></td>
                <td data-label="Typ">{{ LINE_TYPE_LABELS[x.l.line_type] }}</td>
                <td data-label="Antal" class="num">{{ x.qty.replace('.', ',') }}</td>
                <td data-label="Enhet">{{ x.l.unit }}</td>
                <td data-label="À-pris" class="num">{{ displayPrice(x.l.unit_price_ex_vat, 0, 'ex').replace('.', ',') }}</td>
                <td data-label="Summa" class="num">{{ formatOre(x.ex) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
        <template v-else-if="part.locked">
          <BillingLinesEditor :model-value="part.lines.map((l) => toDraft(l, priceMode))" :mode="priceMode" readonly />
        </template>
        <template v-else>
          <BillingLinesEditor v-model="lines" :mode="priceMode" :allow-negative="part.kind === 'correction'" />
        </template>

        <div class="billing-line-footer">
          <div>
            <template v-if="rotAvailable">
              <h4 class="billing-subtitle">ROT-avdrag</h4>
              <div class="row-2">
                <label>ROT-procent
                  <input v-model="form.rot_rate" inputmode="decimal" :disabled="part.locked">
                </label>
                <div class="billing-maxrot">
                  Max-ROT: <strong>{{ formatOre(liveMaxRot) }}</strong>
                  <div class="hint">Max-ROT är ett beräkningsstöd.</div>
                </div>
              </div>
              <table class="data-table bl-table">
                <thead><tr><th>Person</th><th>Namn</th><th>Personnummer</th><th class="num">ROT-belopp (kr)</th></tr></thead>
                <tbody>
                  <template v-if="part.locked">
                    <tr v-for="r in part.rot_recipients.filter((x) => x.amount_ore > 0)" :key="r.position">
                      <td data-label="Person">{{ r.position }}</td>
                      <td data-label="Namn">{{ r.name }}</td>
                      <td data-label="Personnummer">{{ r.personnummer_masked }}</td>
                      <td data-label="ROT-belopp" class="num">{{ formatOre(r.amount_ore) }}</td>
                    </tr>
                  </template>
                  <template v-else>
                    <tr v-for="r in recipients" :key="r.position">
                      <td data-label="Person">{{ r.position }}</td>
                      <td data-label="Namn"><input v-model="r.name" class="bl-input bl-desc" maxlength="200" autocomplete="off"></td>
                      <td data-label="Personnummer">
                        <input v-model="r.personnummer" class="bl-input" placeholder="ÅÅÅÅMMDD-NNNN" autocomplete="off" maxlength="15">
                        <span v-if="pnrState(r.personnummer) === 'bad'" class="bl-invalid">Ogiltigt</span>
                      </td>
                      <td data-label="ROT-belopp" class="num"><input v-model="r.amount" class="bl-input bl-num" inputmode="decimal"></td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </template>
            <p v-else-if="part.kind !== 'correction'" class="hint">ROT är avstängt (se ROT och fastighet).</p>
          </div>
          <BillingSummary
            v-if="liveAmounts"
            :amounts="liveAmounts"
            :rot-total="liveRotTotal"
            :to-pay="liveToPay"
            :show-rot="rotAvailable"
            :rot-rate-bp="part.locked ? part.rot_rate_bp : liveRateBp"
          />
        </div>

        <div v-if="!part.locked" class="modal-actions">
          <button v-if="part.kind !== 'installment'" type="button" class="plain danger" :disabled="busy" @click="removePart">Ta bort delen</button>
          <div class="spacer" />
          <button type="button" class="plain primary" :disabled="busy" @click="savePart">Spara del</button>
        </div>

        <!-- Status -->
        <h4 class="billing-subtitle">Status</h4>
        <div class="billing-status-actions">
          <template v-if="part.status === 'planerad'">
            <button type="button" class="plain primary" :disabled="busy" @click="setStatus('klar')">Markera klar för fakturering</button>
          </template>
          <template v-else-if="part.status === 'klar'">
            <button type="button" class="plain ghost" :disabled="busy" @click="setStatus('planerad')">Tillbaka till planerad</button>
            <label>Fakturadatum<input v-model="invoiceForm.invoiced_date" type="date"></label>
            <label>Fortnox fakturanr<input v-model="invoiceForm.external_invoice_ref" maxlength="100"></label>
            <button type="button" class="plain primary" :disabled="busy" @click="setStatus('fakturerad')">Markera som fakturerad</button>
          </template>
          <template v-else-if="part.status === 'fakturerad'">
            <button type="button" class="plain primary" :disabled="busy" @click="setStatus('betald')">Markera kundens del som betald</button>
          </template>
          <template v-else>
            <button type="button" class="plain ghost" :disabled="busy" @click="setStatus('fakturerad')">Ångra betald</button>
          </template>
          <template v-if="part.locked">
            <button type="button" class="plain ghost" :disabled="busy" @click="correction">Skapa korrigering</button>
          </template>
        </div>

        <template v-if="part.locked">
          <div class="row-2">
            <label>Fortnox fakturanr<input v-model="meta.external_invoice_ref" maxlength="100"></label>
            <label>Anteckning<input v-model="meta.notes" maxlength="2000"></label>
          </div>
          <div class="modal-actions">
            <div class="spacer" />
            <button type="button" class="plain ghost" :disabled="busy" @click="saveMeta">Spara</button>
          </div>

          <h4 class="billing-subtitle">Betalningar</h4>
          <div class="row-2">
            <label>Kund betalt (av {{ formatOre(result.to_pay_ore) }})<input v-model="payments.customer_paid" inputmode="decimal"></label>
            <label>Betaldatum<input v-model="payments.customer_paid_date" type="date"></label>
          </div>
          <template v-if="result.rot_total_ore > 0 || part.rot_status !== 'ej_sokt'">
            <div class="row-2">
              <label>ROT-status
                <select v-model="payments.rot_status">
                  <option v-for="(label, key) in ROT_STATUS_LABELS" :key="key" :value="key">{{ label }}</option>
                </select>
              </label>
              <label>ROT sökt (av {{ formatOre(result.rot_total_ore) }})<input v-model="payments.rot_applied" inputmode="decimal"></label>
              <label>Sökt datum<input v-model="payments.rot_applied_date" type="date"></label>
            </div>
            <div class="row-2">
              <label>ROT utbetalt<input v-model="payments.rot_paid" inputmode="decimal"></label>
              <label>Utbetalt datum<input v-model="payments.rot_paid_date" type="date"></label>
            </div>
          </template>
          <div class="modal-actions">
            <div class="spacer" />
            <button type="button" class="plain primary" :disabled="busy" @click="savePayments">Spara betalningar</button>
          </div>

          <h4 class="billing-subtitle">Versioner</h4>
          <ul class="billing-docs">
            <li v-for="d in part.documents" :key="d.id">
              Version {{ d.version }} · {{ new Date(d.created_at).toLocaleString('sv-SE') }}
              <button type="button" class="link-button" @click="pdf(d.id)">PDF</button>
            </li>
          </ul>
        </template>

        <div class="modal-actions">
          <div class="spacer" />
          <button type="button" class="plain ghost" @click="emit('close')">Stäng</button>
        </div>
      </div>
    </template>
  </UModal>
</template>
