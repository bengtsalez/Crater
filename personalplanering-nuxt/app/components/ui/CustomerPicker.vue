<script setup lang="ts">
import { normalizeCustomerName } from '~/utils/customers'

const props = defineProps<{
  customerId: number | null
  customerName: string
  placeholder?: string
}>()
const emit = defineEmits<{
  'update:customerId': [number | null]
  'update:customerName': [string]
}>()

const { customers } = useAppData()

const items = computed(() =>
  customers.value.map((c) => ({
    name: c.name,
    description: [c.organization_number, c.city, c.project_count ? `${c.project_count} projekt` : '']
      .filter(Boolean)
      .join(' · '),
  }))
)

function onValue(v: string | null) {
  const name = v ?? ''
  emit('update:customerName', name)
  const key = normalizeCustomerName(name)
  const match = key ? customers.value.find((c) => normalizeCustomerName(c.name) === key) : null
  emit('update:customerId', match?.id ?? null)
}
</script>

<template>
  <UInputMenu
    mode="autocomplete"
    :model-value="props.customerName"
    :items="items"
    value-key="name"
    label-key="name"
    description-key="description"
    :filter-fields="['name', 'organization_number', 'city', 'contact_person']"
    :clear="true"
    :placeholder="placeholder ?? 'Sök kund eller skriv ett nytt namn…'"
    :ui="{ content: 'z-[110]' }"
    @update:model-value="onValue"
  >
    <template #empty="{ searchTerm }">
      <span v-if="searchTerm">Ingen befintlig kund matchar – "{{ searchTerm }}" skapas som ny kund</span>
      <span v-else>Börja skriv för att söka bland kunder</span>
    </template>
  </UInputMenu>
</template>
