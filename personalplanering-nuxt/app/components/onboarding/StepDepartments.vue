<script setup lang="ts">
import type { Department } from '~/types'

const { api } = useApi()
const { departments, loadAll } = useAppData()
const toast = useToast()

const sorted = computed(() =>
  [...departments.value].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
)

const newLabel = ref('')
const busyId = ref<number | null>(null)

async function refresh() {
  await loadAll()
}

async function add() {
  const label = newLabel.value.trim()
  if (!label) return
  try {
    await api('POST', '/api/departments', { label })
    newLabel.value = ''
    await refresh()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}

async function rename(d: Department, label: string) {
  const trimmed = label.trim()
  if (!trimmed || trimmed === d.label) return
  try {
    await api('PUT', `/api/departments/${d.id}`, { label: trimmed })
    await refresh()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
    await refresh()
  }
}

async function remove(d: Department) {
  if (!confirm(`Ta bort avdelningen "${d.label}"?`)) return
  busyId.value = d.id
  try {
    await api('DELETE', `/api/departments/${d.id}`)
    await refresh()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    busyId.value = null
  }
}

async function move(index: number, dir: -1 | 1) {
  const list = sorted.value.slice()
  const target = index + dir
  if (target < 0 || target >= list.length) return
  ;[list[index], list[target]] = [list[target]!, list[index]!]
  try {
    await api('POST', '/api/departments/reorder', { ids: list.map((d) => d.id) })
    await refresh()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
async function save(): Promise<boolean> {
  return true
}
defineExpose({ save })
</script>

<template>
  <div class="ob-step">
    <h2>Avdelningar</h2>
    <p class="ob-step-lead">
      Avdelningar grupperar personal och projekt på tidslinjen. Vi har lagt in tre vanliga –
      ändra, ta bort eller lägg till som ni vill.
    </p>

    <ul class="ob-list">
      <li v-for="(d, i) in sorted" :key="d.id" class="ob-list-row">
        <div class="ob-reorder">
          <button type="button" class="plain ghost" :disabled="i === 0" @click="move(i, -1)">↑</button>
          <button type="button" class="plain ghost" :disabled="i === sorted.length - 1" @click="move(i, 1)">↓</button>
        </div>
        <input
          class="ob-grow"
          :value="d.label"
          @change="rename(d, ($event.target as HTMLInputElement).value)"
        >
        <button type="button" class="plain danger" :disabled="busyId === d.id" @click="remove(d)">
          Ta bort
        </button>
      </li>
    </ul>

    <form class="ob-add-row" @submit.prevent="add">
      <input v-model="newLabel" placeholder="Ny avdelning, t.ex. Ventilation">
      <button type="submit" class="plain primary" :disabled="!newLabel.trim()">Lägg till</button>
    </form>
  </div>
</template>
