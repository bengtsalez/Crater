<script setup lang="ts">
// Redigerbar tabell med fakturarader (grundunderlag, ÄTA, korrigering).
// Priset lagras exkl. moms; prisläget påverkar bara visning och inmatning.
import { LINE_TYPES, LINE_TYPE_LABELS, UNITS, formatOre } from '../../../shared/billing'
import {
  draftSumOre,
  newDraft,
  refreshPriceText,
  setPriceText,
  type DraftLine,
  type PriceMode,
} from '~/utils/billingDraft'

const props = defineProps<{
  mode: PriceMode
  readonly?: boolean
  allowNegative?: boolean
}>()
const lines = defineModel<DraftLine[]>({ required: true })

watch(
  () => props.mode,
  (m) => lines.value.forEach((d) => refreshPriceText(d, m))
)

const VAT_OPTIONS = [2500, 1200, 600, 0]

function add(type: DraftLine['line_type']) {
  lines.value = [...lines.value, newDraft(props.mode, type)]
}
function remove(i: number) {
  lines.value = lines.value.filter((_, idx) => idx !== i)
}
function move(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= lines.value.length) return
  const next = [...lines.value]
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  lines.value = next
}
function onType(d: DraftLine) {
  if (d.line_type !== 'arbete') d.rot_eligible = false
}
function onVat(d: DraftLine) {
  // Momssatsen ändrar inte priset exkl. moms – bara visningen inkl. moms.
  refreshPriceText(d, props.mode)
}
</script>

<template>
  <div class="bl-wrap">
    <table class="data-table bl-table">
      <thead>
        <tr>
          <th>Beskrivning</th>
          <th>Typ</th>
          <th class="num">Antal</th>
          <th>Enhet</th>
          <th class="num">À-pris {{ mode === 'inc' ? 'inkl.' : 'exkl.' }} moms</th>
          <th>Moms</th>
          <th class="center">ROT</th>
          <th class="num">Summa {{ mode === 'inc' ? 'inkl.' : 'exkl.' }} moms</th>
          <th v-if="!readonly" />
        </tr>
      </thead>
      <tbody>
        <tr v-if="!lines.length"><td colspan="9" class="empty-state">Inga fakturarader ännu.</td></tr>
        <tr v-for="(d, i) in lines" :key="d.key" :class="{ 'bl-locked': d.locked }">
          <td data-label="Beskrivning">
            <input v-model="d.description" class="bl-input bl-desc" :disabled="readonly" placeholder="Beskrivning" maxlength="500">
          </td>
          <td data-label="Typ">
            <select v-model="d.line_type" class="bl-input" :disabled="readonly || d.locked" @change="onType(d)">
              <option v-for="t in LINE_TYPES" :key="t" :value="t">{{ LINE_TYPE_LABELS[t] }}</option>
            </select>
          </td>
          <td data-label="Antal" class="num">
            <input v-model="d.quantity" class="bl-input bl-num" inputmode="decimal" :disabled="readonly || d.locked">
          </td>
          <td data-label="Enhet">
            <input v-model="d.unit" class="bl-input bl-unit" list="billing-units" :disabled="readonly" maxlength="20">
          </td>
          <td data-label="À-pris" class="num">
            <input
              :value="d.price_text"
              class="bl-input bl-num"
              inputmode="decimal"
              :disabled="readonly || d.locked"
              @input="setPriceText(d, ($event.target as HTMLInputElement).value, mode)"
              @blur="refreshPriceText(d, mode)"
            >
          </td>
          <td data-label="Moms">
            <select v-model.number="d.vat_rate_bp" class="bl-input" :disabled="readonly || d.locked" @change="onVat(d)">
              <option v-for="v in VAT_OPTIONS" :key="v" :value="v">{{ v / 100 }} %</option>
            </select>
          </td>
          <td data-label="ROT" class="center">
            <input
              v-model="d.rot_eligible"
              type="checkbox"
              :disabled="readonly || d.locked || d.line_type !== 'arbete'"
              :title="d.line_type === 'arbete' ? 'ROT-berättigat arbete' : 'Endast arbete kan vara ROT-berättigat'"
            >
          </td>
          <td data-label="Summa" class="num">
            <span v-if="draftSumOre(d, mode) !== null">{{ formatOre(draftSumOre(d, mode)!) }}</span>
            <span v-else class="bl-invalid">Ogiltigt</span>
          </td>
          <td v-if="!readonly" data-label="" class="bl-actions">
            <button type="button" class="plain ghost" title="Flytta upp" @click="move(i, -1)">↑</button>
            <button type="button" class="plain ghost" title="Flytta ned" @click="move(i, 1)">↓</button>
            <button type="button" class="plain danger" :disabled="d.locked" title="Ta bort raden" @click="remove(i)">✕</button>
          </td>
        </tr>
      </tbody>
    </table>
    <datalist id="billing-units">
      <option v-for="u in UNITS" :key="u" :value="u" />
    </datalist>
    <div v-if="!readonly" class="bl-add">
      <button type="button" class="plain ghost" @click="add('arbete')">+ Arbete</button>
      <button type="button" class="plain ghost" @click="add('material')">+ Material</button>
      <button type="button" class="plain ghost" @click="add('ovrigt')">+ Övrigt</button>
      <span v-if="allowNegative" class="hint">Negativt antal krediterar.</span>
    </div>
  </div>
</template>
