<script setup lang="ts">
// Fliken "Fakturering" (admin/member; servern kontrollerar varje anrop).
// Flöde: 1) fakturaposter → 2) procentuella delbetalningar → 3) underlag.
import { formatOre, PART_KIND_LABELS, PART_STATUS_LABELS } from '../../../shared/billing'

const props = defineProps<{ projectId: number }>()
const { view, loading, load } = useProjectBilling()
const { currentUser } = useAppData()
const toast = useToast()

const partId = ref<number | null>(null)
const ataOpen = ref(false)

watch(
  () => props.projectId,
  async (id) => {
    view.value = null
    partId.value = null
    try {
      await load(id)
    } catch (err) {
      toast.add({ title: (err as Error).message, color: 'error' })
    }
  },
  { immediate: true }
)

const v = computed(() => (view.value && view.value.project.id === props.projectId ? view.value : null))
const parts = computed(() => v.value?.parts ?? [])
function problems(id: number, kind: string, locked: boolean): string {
  if (!v.value || locked) return ''
  const errs = [...(kind === 'installment' ? v.value.calc.base_errors : []), ...(v.value.calc.parts[id]?.errors ?? [])]
  return errs.join('\n')
}
</script>

<template>
  <div class="billing">
    <div v-if="!v" class="empty-state">{{ loading ? 'Laddar…' : 'Kunde inte ladda faktureringen.' }}</div>
    <template v-else>
      <BillingOverview :view="v" />
      <BillingBaseSection :view="v" :project-id="projectId" />
      <BillingPlanSection :view="v" :project-id="projectId" />

      <section class="billing-section">
        <div class="billing-step">
          <span class="billing-step-num">3</span>
          <h3>Fakturering</h3>
          <div class="spacer" />
          <button type="button" class="plain ghost" @click="ataOpen = true">Hämta ÄTA</button>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>Underlag</th><th>Del</th><th>Status</th><th class="num">Belopp</th><th class="num">Att betala</th></tr>
          </thead>
          <tbody>
            <tr v-if="!parts.length"><td colspan="5" class="empty-state">Inga delbetalningar ännu.</td></tr>
            <tr v-for="p in parts" :key="p.id" class="clickable" @click="partId = p.id">
              <td data-label="Underlag">{{ p.document_number }}</td>
              <td data-label="Del">
                <span v-if="problems(p.id, p.kind, p.locked) || p.ata?.deviation" class="billing-dot" :title="problems(p.id, p.kind, p.locked) || 'ÄTA ändrad'" />
                {{ p.kind === 'installment' ? '' : PART_KIND_LABELS[p.kind] + ': ' }}{{ p.name }}
              </td>
              <td data-label="Status"><span class="badge" :class="'bp-' + p.status">{{ PART_STATUS_LABELS[p.status] }}</span></td>
              <td data-label="Belopp" class="num">{{ formatOre(v.calc.parts[p.id]?.amounts.inc_ore ?? 0) }}</td>
              <td data-label="Att betala" class="num">{{ formatOre(v.calc.parts[p.id]?.to_pay_ore ?? 0) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <BillingRotPayments :view="v" />
      <BillingCompany :is-admin="currentUser?.role === 'admin'" />

      <BillingPartModal :view="v" :part-id="partId" @close="partId = null" @open-part="partId = $event" />
      <BillingAtaImportModal v-model:open="ataOpen" :project-id="projectId" />
    </template>
  </div>
</template>
