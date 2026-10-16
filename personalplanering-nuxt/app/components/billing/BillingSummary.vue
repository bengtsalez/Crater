<script setup lang="ts">
import { formatOre, formatPercentBp, type Amounts } from '../../../shared/billing'

defineProps<{
  amounts: Amounts
  rotTotal?: number
  toPay?: number
  showRot?: boolean
  rotRateBp?: number
}>()
</script>

<template>
  <table class="billing-summary">
    <tbody>
      <tr><td>Arbetskostnad exkl. moms</td><td>{{ formatOre(amounts.work_ex_ore) }}</td></tr>
      <tr><td>Material exkl. moms</td><td>{{ formatOre(amounts.material_ex_ore) }}</td></tr>
      <tr><td>Övrigt exkl. moms</td><td>{{ formatOre(amounts.other_ex_ore) }}</td></tr>
      <tr class="strong"><td>Summa exkl. moms</td><td>{{ formatOre(amounts.ex_ore) }}</td></tr>
      <tr v-for="(g, rate) in amounts.vat_by_rate" :key="rate">
        <td>Moms {{ formatPercentBp(Number(rate)) }}</td><td>{{ formatOre(g.vat_ore) }}</td>
      </tr>
      <tr v-if="!Object.keys(amounts.vat_by_rate).length"><td>Moms</td><td>{{ formatOre(0) }}</td></tr>
      <tr class="strong"><td>Summa inkl. moms före ROT</td><td>{{ formatOre(amounts.inc_ore) }}</td></tr>
      <template v-if="showRot">
        <tr><td>ROT-avdrag<span v-if="rotRateBp !== undefined"> ({{ formatPercentBp(rotRateBp) }})</span></td><td>{{ formatOre(-(rotTotal || 0)) }}</td></tr>
      </template>
      <tr class="total"><td>Att betala</td><td>{{ formatOre(toPay ?? amounts.inc_ore) }}</td></tr>
    </tbody>
  </table>
</template>
