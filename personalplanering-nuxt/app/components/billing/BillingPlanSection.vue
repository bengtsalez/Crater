<script setup lang="ts">
// Steg 2: fördela posternas totalsumma procentuellt på delbetalningar.
import {
  divRound,
  formatOre,
  formatPercentBp,
  kronorToOre,
  LINE_TYPE_LABELS,
  parseScaled,
  PART_STATUS_LABELS,
  vatOf,
  type PartStatus,
} from '../../../shared/billing'
import type { ProjectBillingView } from '../../../shared/billingTypes'
import { oreToInput, percentInput, type PriceMode } from '~/utils/billingDraft'

const props = defineProps<{ view: ProjectBillingView; projectId: number }>()
const { mutate, priceMode } = useProjectBilling()
const toast = useToast()

interface PlanRow {
  key: string
  id: number | null
  name: string
  percent: string
  planned_date: string
  locked: boolean
  status: PartStatus | null
}
let seq = 0
const rows = ref<PlanRow[]>([])
const saving = ref(false)

const installments = computed(() => props.view.parts.filter((p) => p.kind === 'installment'))
const total = computed(() => props.view.settings.base_total_inc_ore ?? 0)
const hasLines = computed(() => props.view.base_lines.length > 0)

function reset() {
  rows.value = installments.value.map((p) => ({
    key: `p${p.id}`,
    id: p.id,
    name: p.name,
    percent: percentInput(p.percent_bp),
    planned_date: p.planned_date ?? '',
    locked: p.locked,
    status: p.status,
  }))
}
watch(installments, reset, { immediate: true })

const bpOf = (r: PlanRow) => Number(parseScaled(r.percent, 2) ?? 0n)
const percentSum = computed(() => rows.value.reduce((s, r) => s + bpOf(r), 0))
const amountOf = (r: PlanRow) => Number(divRound(BigInt(total.value) * BigInt(bpOf(r)), 10000n))
const dirty = computed(
  () =>
    JSON.stringify(rows.value.map((r) => [r.id, r.name, r.percent, r.planned_date])) !==
    JSON.stringify(installments.value.map((p) => [p.id, p.name, percentInput(p.percent_bp), p.planned_date ?? '']))
)

const newRow = (name: string, percent: string): PlanRow => ({
  key: `n${++seq}`, id: null, name, percent, planned_date: '', locked: false, status: null,
})
function add() {
  const left = Math.max(0, 10000 - percentSum.value)
  rows.value = [...rows.value, newRow(`Delbetalning ${rows.value.length + 1}`, left ? percentInput(left) : '')]
}
function preset(p: number[]) {
  rows.value = p.map((x, i) => newRow(`Delbetalning ${i + 1}`, String(x)))
}
function remove(i: number) {
  rows.value = rows.value.filter((_, idx) => idx !== i)
}

async function save() {
  saving.value = true
  try {
    await mutate('PUT', `/api/projects/${props.projectId}/billing/installments`, {
      installments: rows.value.map((r) => ({ id: r.id, name: r.name, percent: r.percent, planned_date: r.planned_date || null })),
    })
    toast.add({ title: 'Delbetalningar sparade', color: 'success' })
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}

// ---- Fördelning per post (hopfälld) ----
const allocOpen = ref(false)
const baseLines = computed(() => props.view.base_lines)
const alloc = ref<Record<string, string>>({})
const savingAlloc = ref(false)
const cellKey = (partId: number, lineId: number) => `${partId}:${lineId}`
const allocToText = (exOre: number, vatBp: number, mode: PriceMode) => oreToInput(mode === 'inc' ? exOre + vatOf(exOre, vatBp) : exOre)
const savedAlloc = (partId: number, lineId: number) =>
  props.view.allocations.find((x) => x.part_id === partId && x.line_id === lineId)?.amount_ex_ore ?? 0

function resetAlloc() {
  const m: Record<string, string> = {}
  for (const p of installments.value) {
    for (const l of baseLines.value) m[cellKey(p.id, l.id)] = allocToText(savedAlloc(p.id, l.id), l.vat_rate_bp, priceMode.value)
  }
  alloc.value = m
}
watch(() => [props.view.allocations, installments.value, baseLines.value, priceMode.value], resetAlloc, { immediate: true })

function cellExOre(partId: number, lineId: number): number | null {
  const l = baseLines.value.find((x) => x.id === lineId)!
  const text = alloc.value[cellKey(partId, lineId)] ?? '0'
  const saved = savedAlloc(partId, lineId)
  // Oförändrad cell → exakt sparat belopp (ingen avrundningsdrift i inkl.-läge).
  if (text === allocToText(saved, l.vat_rate_bp, priceMode.value)) return saved
  const v = kronorToOre(text)
  if (v === null) return null
  return priceMode.value === 'inc' ? Math.round((v * 10000) / (10000 + l.vat_rate_bp)) : v
}
const lineDiff = (lineId: number) =>
  installments.value.reduce((s, p) => s + (cellExOre(p.id, lineId) ?? 0), 0) - (props.view.calc.line_allocation[lineId]?.total_ex_ore ?? 0)
const allocDirty = computed(() =>
  installments.value.some((p) => baseLines.value.some((l) => alloc.value[cellKey(p.id, l.id)] !== allocToText(savedAlloc(p.id, l.id), l.vat_rate_bp, priceMode.value)))
)
const allocProblem = computed(() => props.view.calc.base_errors.some((e) => /fördelad/.test(e)))

async function saveAlloc() {
  const allocations: { part_id: number; line_id: number; amount_ex_ore: number }[] = []
  for (const p of installments.value.filter((x) => !x.locked)) {
    for (const l of baseLines.value) {
      const v = cellExOre(p.id, l.id)
      if (v === null) {
        toast.add({ title: `Ogiltigt belopp för "${l.description}".`, color: 'error' })
        return
      }
      allocations.push({ part_id: p.id, line_id: l.id, amount_ex_ore: v })
    }
  }
  savingAlloc.value = true
  try {
    await mutate('PUT', `/api/projects/${props.projectId}/billing/allocations`, { allocations })
    toast.add({ title: 'Fördelningen sparad', color: 'success' })
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    savingAlloc.value = false
  }
}
async function proposeAlloc() {
  savingAlloc.value = true
  try {
    await mutate('POST', `/api/projects/${props.projectId}/billing/allocations-reset`)
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    savingAlloc.value = false
  }
}
</script>

<template>
  <section class="billing-section" :class="{ 'billing-disabled': !hasLines }">
    <div class="billing-step">
      <span class="billing-step-num">2</span>
      <h3>Delbetalningar</h3>
      <span v-if="hasLines" class="hint">av {{ formatOre(total) }}</span>
      <span v-else class="hint">Lägg till fakturaposter först</span>
    </div>

    <template v-if="hasLines">
      <table class="data-table bl-table billing-plan">
        <thead>
          <tr><th>Namn</th><th class="num">Procent</th><th class="num">Belopp</th><th>Datum</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          <tr v-if="!rows.length">
            <td colspan="6" class="empty-state">
              <button type="button" class="plain ghost" @click="preset([100])">100 %</button>
              <button type="button" class="plain ghost" @click="preset([50, 50])">2 × 50 %</button>
              <button type="button" class="plain ghost" @click="preset([30, 40, 30])">30 / 40 / 30</button>
            </td>
          </tr>
          <tr v-for="(r, i) in rows" :key="r.key" :class="{ 'bl-locked': r.locked }">
            <td data-label="Namn"><input v-model="r.name" class="bl-input bl-desc" :disabled="r.locked" maxlength="200"></td>
            <td data-label="Procent" class="num"><input v-model="r.percent" class="bl-input bl-pct" inputmode="decimal" :disabled="r.locked"> %</td>
            <td data-label="Belopp" class="num">{{ formatOre(amountOf(r)) }}</td>
            <td data-label="Datum"><input v-model="r.planned_date" class="bl-input" type="date" :disabled="r.locked"></td>
            <td data-label="Status">
              <span v-if="r.status" class="badge" :class="'bp-' + r.status">{{ PART_STATUS_LABELS[r.status] }}</span>
            </td>
            <td data-label="" class="bl-actions">
              <button type="button" class="plain danger" :disabled="r.locked" title="Ta bort" @click="remove(i)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="billing-totals">
        <button type="button" class="plain ghost" @click="add">+ Delbetalning</button>
        <span v-if="rows.length" class="billing-pill" :class="percentSum === 10000 ? 'ok' : 'bad'">
          {{ percentSum === 10000 ? 'Summa 100 %' : percentSum < 10000 ? `Kvar att fördela: ${formatPercentBp(10000 - percentSum)}` : `${formatPercentBp(percentSum - 10000)} för mycket` }}
        </span>
        <div class="spacer" />
        <button v-if="dirty" type="button" class="plain ghost" @click="reset">Ångra</button>
        <button type="button" class="plain primary" :disabled="saving || !dirty" @click="save">Spara delbetalningar</button>
      </div>

      <template v-if="installments.length">
        <button type="button" class="link-button billing-collapse" @click="allocOpen = !allocOpen">
          {{ allocOpen ? '▾' : '▸' }} Justera fördelning per post
          <span v-if="allocProblem" class="bl-invalid">· stämmer inte</span>
        </button>
        <template v-if="allocOpen">
          <div class="billing-scroll">
            <table class="data-table billing-alloc">
              <thead>
                <tr>
                  <th>Post</th>
                  <th v-for="p in installments" :key="p.id" class="num">{{ p.name }}</th>
                  <th class="num">Diff</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="l in baseLines" :key="l.id">
                  <td data-label="Post">{{ l.description }} <span class="hint">{{ LINE_TYPE_LABELS[l.line_type] }}</span></td>
                  <td v-for="p in installments" :key="p.id" :data-label="p.name" class="num">
                    <input v-model="alloc[cellKey(p.id, l.id)]" class="bl-input bl-num" inputmode="decimal" :disabled="p.locked">
                  </td>
                  <td data-label="Diff" class="num" :class="{ 'bl-invalid': lineDiff(l.id) !== 0 }">{{ formatOre(lineDiff(l.id)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="billing-totals">
            <span class="hint">{{ priceMode === 'inc' ? 'Inkl.' : 'Exkl.' }} moms</span>
            <div class="spacer" />
            <button type="button" class="plain ghost" :disabled="savingAlloc" @click="proposeAlloc">Fördela proportionellt</button>
            <button type="button" class="plain primary" :disabled="savingAlloc || !allocDirty" @click="saveAlloc">Spara fördelning</button>
          </div>
        </template>
      </template>
    </template>
  </section>
</template>
