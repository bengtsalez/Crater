<script setup lang="ts">
import type { Resource } from '~/types'
import { colorForResource } from '~/utils/colors'

const { resources, loadAll } = useAppData()
const { labelFor: departmentLabel } = useDepartments()
const { openResourceModal } = useModals()
const { api } = useApi()
const toast = useToast()

const employees = computed(() => resources.value.filter((r) => r.type === 'anstalld'))
const subcontractors = computed(() => resources.value.filter((r) => r.type === 'underentreprenor'))

async function remove(id: number) {
  if (!confirm('Ta bort personen?')) return
  try {
    await api('DELETE', `/api/resources/${id}`)
    await loadAll()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}
</script>

<template>
  <section>
    <div class="toolbar">
      <div class="spacer" />
      <button class="plain primary" @click="openResourceModal(null)">+ Lägg till person</button>
    </div>

    <h2 class="group-title">Anställda</h2>
    <table class="data-table">
      <thead>
        <tr><th /><th>Namn</th><th>Kategori</th><th>Telefon</th><th>Aktiv</th><th /></tr>
      </thead>
      <tbody>
        <tr v-for="r in employees" :key="r.id" class="clickable" @click="openResourceModal(r)">
          <td data-label="Färg"><span class="res-swatch" :style="{ background: colorForResource(r) }" /></td>
          <td data-label="Namn">{{ r.name }}</td>
          <td data-label="Kategori">{{ departmentLabel(r.category) }}</td>
          <td data-label="Telefon">{{ r.phone || '–' }}</td>
          <td data-label="Aktiv">{{ r.active ? 'Ja' : 'Nej' }}</td>
          <td data-label=""><button class="plain danger" @click.stop="remove(r.id)">Ta bort</button></td>
        </tr>
      </tbody>
    </table>

    <h2 class="group-title">Underentreprenörer</h2>
    <table class="data-table">
      <thead>
        <tr><th /><th>Namn</th><th>Telefon</th><th>Aktiv</th><th /></tr>
      </thead>
      <tbody>
        <tr v-for="r in subcontractors" :key="r.id" class="clickable" @click="openResourceModal(r)">
          <td data-label="Färg"><span class="res-swatch" :style="{ background: colorForResource(r) }" /></td>
          <td data-label="Namn">{{ r.name }}</td>
          <td data-label="Telefon">{{ r.phone || '–' }}</td>
          <td data-label="Aktiv">{{ r.active ? 'Ja' : 'Nej' }}</td>
          <td data-label=""><button class="plain danger" @click.stop="remove(r.id)">Ta bort</button></td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
