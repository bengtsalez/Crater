<script setup lang="ts">
// Hopfälld sektion: kund- och ROT-betalningar samt ROT per person (för att
// upptäcka dubbelt använt ROT).
import { formatOre, PART_KIND_LABELS, ROT_STATUS_LABELS } from '../../../shared/billing'
import type { ProjectBillingView } from '../../../shared/billingTypes'

const props = defineProps<{ view: ProjectBillingView }>()
const open = ref(false)
const ov = computed(() => props.view.calc.overview)

const rotRows = computed(() =>
  props.view.parts.flatMap((p) =>
    p.rot_recipients
      .filter((r) => r.amount_ore > 0)
      .map((r) => ({
        key: `${p.id}-${r.position}`,
        part: `${p.document_number} · ${PART_KIND_LABELS[p.kind]} ${p.name}`,
        name: r.name || '–',
        pnr: r.personnummer_masked || '–',
        amount: r.amount_ore,
        status: ROT_STATUS_LABELS[p.rot_status],
      }))
  )
)
const perPerson = computed(() => {
  const m = new Map<string, { name: string; pnr: string; total: number }>()
  for (const r of rotRows.value) {
    const k = r.pnr + r.name
    const e = m.get(k) ?? { name: r.name, pnr: r.pnr, total: 0 }
    e.total += r.amount
    m.set(k, e)
  }
  return [...m.values()]
})
</script>

<template>
  <section class="billing-section">
    <button type="button" class="link-button billing-collapse" @click="open = !open">{{ open ? '▾' : '▸' }} ROT och betalningar</button>
    <template v-if="open">
      <div class="billing-split">
        <table class="billing-summary">
          <caption>Kund</caption>
          <tbody>
            <tr><td>Kundens betalningsdel</td><td>{{ formatOre(ov.customer_share_ore) }}</td></tr>
            <tr><td>Betalt</td><td>{{ formatOre(ov.customer_paid_ore) }}</td></tr>
            <tr class="strong"><td>Kvar (fakturerat)</td><td>{{ formatOre(ov.customer_outstanding_ore) }}</td></tr>
          </tbody>
        </table>
        <table class="billing-summary">
          <caption>ROT från Skatteverket</caption>
          <tbody>
            <tr><td>Planerat</td><td>{{ formatOre(ov.rot_planned_ore) }}</td></tr>
            <tr><td>Sökt</td><td>{{ formatOre(ov.rot_applied_ore) }}</td></tr>
            <tr><td>Utbetalt</td><td>{{ formatOre(ov.rot_paid_ore) }}</td></tr>
            <tr v-if="ov.rot_rejected_ore"><td>Avslag</td><td>{{ formatOre(ov.rot_rejected_ore) }}</td></tr>
            <tr class="strong"><td>Kvar (fakturerat)</td><td>{{ formatOre(ov.rot_outstanding_ore) }}</td></tr>
          </tbody>
        </table>
      </div>
      <table v-if="rotRows.length" class="data-table">
        <thead><tr><th>Underlag</th><th>Person</th><th>Personnummer</th><th class="num">ROT</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="r in rotRows" :key="r.key">
            <td data-label="Underlag">{{ r.part }}</td>
            <td data-label="Person">{{ r.name }}</td>
            <td data-label="Personnummer">{{ r.pnr }}</td>
            <td data-label="ROT" class="num">{{ formatOre(r.amount) }}</td>
            <td data-label="Status">{{ r.status }}</td>
          </tr>
          <tr v-for="p in perPerson" :key="'s' + p.pnr + p.name" class="acc-total">
            <td data-label="">Summa i projektet</td>
            <td data-label="Person">{{ p.name }}</td>
            <td data-label="Personnummer">{{ p.pnr }}</td>
            <td data-label="ROT" class="num">{{ formatOre(p.total) }}</td>
            <td data-label="" />
          </tr>
        </tbody>
      </table>
      <p class="hint">Crater känner inte till kundens kvarvarande ROT-utrymme.</p>
    </template>
  </section>
</template>
