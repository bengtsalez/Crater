<script setup lang="ts">
import type { Customer } from '~/types'
import type { DropdownMenuItem } from '@nuxt/ui'

const { customers } = useAppData()
const { openCustomerDetail } = useUiState()
const { openCustomerModal } = useModals()

const search = ref('')
const sortColumn = ref('name')
const sortDirection = ref<'asc' | 'desc'>('asc')

const columns = [
  { key: 'name', label: 'Kund' },
  { key: 'contact_person', label: 'Kontaktperson' },
  { key: 'phone', label: 'Telefon' },
  { key: 'email', label: 'E-post' },
  { key: 'city', label: 'Ort' },
  { key: 'project_count', label: 'Projekt' },
]

function toggleSort(field: string) {
  if (sortColumn.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortColumn.value = field
    sortDirection.value = 'asc'
  }
}

const collator = new Intl.Collator('sv', { numeric: true, sensitivity: 'base' })

function matchesQuery(c: Customer) {
  const q = search.value.trim().toLowerCase()
  if (!q) return true
  return [c.name, c.contact_person, c.phone, c.mobile, c.email, c.organization_number, c.address, c.city].some(
    (v) => String(v ?? '').toLowerCase().includes(q)
  )
}

const visible = computed(() => {
  const filtered = customers.value.filter(matchesQuery)
  const sorted = [...filtered].sort((a, b) => {
    if (sortColumn.value === 'project_count') return a.project_count - b.project_count
    const av = String((a as unknown as Record<string, unknown>)[sortColumn.value] ?? '')
    const bv = String((b as unknown as Record<string, unknown>)[sortColumn.value] ?? '')
    return collator.compare(av, bv)
  })
  return sortDirection.value === 'desc' ? sorted.reverse() : sorted
})

function lastProjectLabel(c: Customer) {
  if (!c.last_project_number) return '–'
  return `${c.last_project_number} – ${c.last_project_name}`
}

function rowActions(c: Customer): DropdownMenuItem[][] {
  return [[{ label: 'Redigera', onSelect: () => openCustomerModal(c) }]]
}
</script>

<template>
  <section>
    <div class="toolbar">
      <label class="filter-label">Sök:
        <input v-model="search" type="text" placeholder="Namn, kontakt, telefon, e-post, org.nr, adress…">
      </label>
      <div class="spacer" />
      <button class="plain primary" @click="openCustomerModal(null)">+ Ny kund</button>
    </div>

    <table class="data-table sortable">
      <thead>
        <tr>
          <th
            v-for="c in columns"
            :key="c.key"
            data-sort
            :class="{
              'sort-asc': sortColumn === c.key && sortDirection === 'asc',
              'sort-desc': sortColumn === c.key && sortDirection === 'desc',
            }"
            @click="toggleSort(c.key)"
          >
            {{ c.label }}
          </th>
          <th>Senaste projekt</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-if="!visible.length"><td colspan="8" class="empty-state">Inga kunder ännu.</td></tr>
        <tr v-for="c in visible" :key="c.id" class="clickable" @click="openCustomerDetail(c.id)">
          <td data-label="Kund">{{ c.name }}</td>
          <td data-label="Kontaktperson">{{ c.contact_person || '–' }}</td>
          <td data-label="Telefon">{{ c.phone || c.mobile || '–' }}</td>
          <td data-label="E-post">{{ c.email || '–' }}</td>
          <td data-label="Ort">{{ c.city || '–' }}</td>
          <td data-label="Projekt">{{ c.project_count }}</td>
          <td data-label="Senaste projekt">{{ lastProjectLabel(c) }}</td>
          <td data-label="">
            <UDropdownMenu :items="rowActions(c)" :content="{ align: 'end' }">
              <button class="plain" aria-label="Fler åtgärder" @click.stop>⋯</button>
            </UDropdownMenu>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
