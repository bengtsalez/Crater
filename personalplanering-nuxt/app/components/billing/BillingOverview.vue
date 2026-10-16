<script setup lang="ts">
import { formatOre } from '../../../shared/billing'
import type { ProjectBillingView } from '../../../shared/billingTypes'

const props = defineProps<{ view: ProjectBillingView }>()
const ov = computed(() => props.view.calc.overview)
const outstanding = computed(() => ov.value.customer_outstanding_ore + ov.value.rot_outstanding_ore)
</script>

<template>
  <div class="billing-kpis">
    <div class="billing-kpi"><span>Totalt före ROT</span><strong>{{ formatOre(ov.total_inc_ore) }}</strong></div>
    <div class="billing-kpi"><span>Fakturerat</span><strong>{{ formatOre(ov.invoiced_inc_ore) }}</strong></div>
    <div class="billing-kpi"><span>Kvar att fakturera</span><strong>{{ formatOre(ov.remaining_inc_ore) }}</strong></div>
    <div class="billing-kpi">
      <span>Kvar att betala</span><strong>{{ formatOre(outstanding) }}</strong>
      <small>Kund {{ formatOre(ov.customer_outstanding_ore) }} · ROT {{ formatOre(ov.rot_outstanding_ore) }}</small>
    </div>
  </div>
</template>
