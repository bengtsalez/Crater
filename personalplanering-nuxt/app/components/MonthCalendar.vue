<script setup lang="ts">
import { toISO, addDays, addMonths, startOfMonth, mondayOf, isSameDay } from '~/utils/dates'
import { DOW_LABELS, MONTH_LABELS } from '~/utils/constants'

const { resources, assignments } = useAppData()
const { openAssignmentModal } = useModals()

const cursor = ref(startOfMonth(new Date()))
const filterResourceId = ref('')

const label = computed(() => `${MONTH_LABELS[cursor.value.getMonth()]} ${cursor.value.getFullYear()}`)

const today = new Date()

function assignmentsOnDate(isoDate: string) {
  return assignments.value
    .filter((a) => {
      if (a.start_date > isoDate || a.end_date < isoDate) return false
      if (filterResourceId.value && a.resource_id !== Number(filterResourceId.value)) return false
      return true
    })
    .sort((a, b) => a.project_number.localeCompare(b.project_number))
}

const dayCells = computed(() => {
  const firstOfMonth = cursor.value
  const lastOfMonth = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + 1, 0)
  const gridStart = mondayOf(firstOfMonth)
  const gridEnd = addDays(mondayOf(lastOfMonth), 6)
  const cells: {
    iso: string
    day: number
    otherMonth: boolean
    isToday: boolean
    chips: { id: number; start: boolean; text: string; title: string }[]
  }[] = []
  for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) {
    const iso = toISO(d)
    cells.push({
      iso,
      day: d.getDate(),
      otherMonth: d.getMonth() !== cursor.value.getMonth(),
      isToday: isSameDay(d, today),
      chips: assignmentsOnDate(iso).map((a) => ({
        id: a.id,
        start: a.start_date === iso,
        text: `${a.project_number} · ${a.resource_name}`,
        title: `${a.project_number} – ${a.project_name} (${a.resource_name})`,
      })),
    })
  }
  return cells
})

function prev() {
  cursor.value = addMonths(cursor.value, -1)
}
function next() {
  cursor.value = addMonths(cursor.value, 1)
}
function goToday() {
  cursor.value = startOfMonth(new Date())
}
</script>

<template>
  <section>
    <div class="toolbar">
      <button class="plain" @click="prev">‹</button>
      <span class="range-label">{{ label }}</span>
      <button class="plain" @click="next">›</button>
      <button class="plain" @click="goToday">Idag</button>
      <div class="spacer" />
      <label class="filter-label">Visa:
        <select v-model="filterResourceId">
          <option value="">Alla</option>
          <option v-for="r in resources" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </label>
    </div>
    <div class="month-grid">
      <div v-for="l in DOW_LABELS" :key="l" class="month-dow">{{ l }}</div>
      <div
        v-for="cell in dayCells"
        :key="cell.iso"
        class="month-day"
        :class="{ 'other-month': cell.otherMonth, today: cell.isToday }"
        @click="openAssignmentModal({ date: cell.iso })"
      >
        <div class="day-num">{{ cell.day }}</div>
        <span
          v-for="chip in cell.chips"
          :key="chip.id"
          class="chip"
          :class="{ start: chip.start }"
          :title="chip.title"
          @click.stop="openAssignmentModal({ assignment: assignments.find((a) => a.id === chip.id) ?? null })"
        >{{ chip.text }}</span>
      </div>
    </div>
  </section>
</template>
