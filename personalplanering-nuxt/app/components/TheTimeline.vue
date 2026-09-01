<script setup lang="ts">
import type { Resource } from '~/types'
import {
  toISO, fromISO, addDays, mondayOf, isoWeek, isSameDay, isWeekend, isHoliday, holidayName,
} from '~/utils/dates'
import { colorForResource, shadeForProject, readableText } from '~/utils/colors'
import { isProjectPast } from '~/utils/analytics'
import { taskCountLabel } from '~/utils/format'
import {
  DOW_LABELS,
  TL_LABEL_WIDTH, TL_DAY_WIDTH, TL_VISIBLE_DAYS,
} from '~/utils/constants'

const { resources, projects, assignments, tasks, currentUser, loadAll } = useAppData()
const { keys: departmentKeys, labelFor: departmentLabel, options: departmentOptions } = useDepartments()
const { goToMyTasksForProject, openProjectDetail } = useUiState()
const { openAssignmentModal } = useModals()
const { api } = useApi()
const toast = useToast()

const tlStart = ref(mondayOf(new Date()))
const filterType = ref('')
const searchQuery = ref('')
const showHolidays = ref(false)

const today = new Date()

function matchesProjectSearch(projectNumber: string | null | undefined) {
  if (!searchQuery.value) return true
  return String(projectNumber ?? '').toLowerCase().includes(searchQuery.value.toLowerCase())
}

function myOpenTaskCountForProject(projectId: number) {
  if (!currentUser.value) return 0
  return tasks.value.filter((t) => t.project_id === projectId && t.status !== 'avslutad').length
}

const calendarDays = computed(() =>
  Array.from({ length: TL_VISIBLE_DAYS }, (_, i) => addDays(tlStart.value, i))
)
const days = computed(() =>
  showHolidays.value ? calendarDays.value : calendarDays.value.filter((d) => !isHoliday(d))
)
const rangeStartISO = computed(() => toISO(calendarDays.value[0]!))
const rangeEndISO = computed(() => toISO(calendarDays.value[calendarDays.value.length - 1]!))
const rangeLabel = computed(() => `${rangeStartISO.value} – ${rangeEndISO.value}`)

const employeeCategoryFilter = computed(() =>
  departmentKeys.value.includes(filterType.value) ? filterType.value : null
)
const employeesVisible = computed(
  () => !filterType.value || filterType.value === 'anstalld' || Boolean(employeeCategoryFilter.value)
)
const employeeGroups = computed(() => {
  const cats: (string | null)[] = employeeCategoryFilter.value
    ? [employeeCategoryFilter.value]
    : [...departmentKeys.value, null]
  return cats.map((category) => ({
    category,
    label: category ? departmentLabel(category) : 'Ej kategoriserad',
    resources: employeesVisible.value
      ? resources.value.filter((r) => r.type === 'anstalld' && r.category === category)
      : [],
  }))
})
const subcontractors = computed(() =>
  filterType.value && filterType.value !== 'underentreprenor'
    ? []
    : resources.value.filter((r) => r.type === 'underentreprenor')
)

// Projekt som ännu inte planerats in (status "aktiv") – visas som lista bredvid tidslinjen.
const unplannedProjects = computed(() =>
  projects.value
    .filter((p) => p.status === 'aktiv' && matchesProjectSearch(p.project_number))
    .sort((a, b) => a.project_number.localeCompare(b.project_number, 'sv'))
)

const gridCols = computed(
  () => `${TL_LABEL_WIDTH}px repeat(${days.value.length}, ${TL_DAY_WIDTH}px)`
)

const weekHeaderCells = computed(() => {
  const cells: { span: number; week: number }[] = []
  const d = days.value
  let i = 0
  while (i < d.length) {
    const wk = isoWeek(d[i]!)
    let span = 1
    while (i + span < d.length && isoWeek(d[i + span]!) === wk) span++
    cells.push({ span, week: wk })
    i += span
  }
  return cells
})

function dayClasses(d: Date) {
  return {
    weekend: isWeekend(d),
    holiday: isHoliday(d),
    today: isSameDay(d, today),
  }
}

const visibleResources = computed<Resource[]>(() => [
  ...employeeGroups.value.flatMap((g) => g.resources),
  ...subcontractors.value,
])

// ---------- Overlay (mätbaserad, som i gamla appen) ----------

interface OverlayMarker {
  key: string
  left: number
  top: number
  past: boolean
  label: string
  tip: string
  badge: string | null
  projectId: number
}
interface OverlayBar {
  key: string
  left: number
  top: number
  width: number
  height: number
  bg: string
  color: string
  label: string
  title: string
  past: boolean
  assignmentId: number
}

const gridRef = ref<HTMLElement | null>(null)
const wrapRef = ref<HTMLElement | null>(null)
const markers = ref<OverlayMarker[]>([])
const bars = ref<OverlayBar[]>([])

function computeOverlay() {
  const gridEl = gridRef.value
  if (!gridEl) return

  const dayHeaderEl = gridEl.querySelector<HTMLElement>('.tl-day-header')
  const baselineTop = dayHeaderEl ? dayHeaderEl.offsetTop + dayHeaderEl.offsetHeight : 0
  const categoryMarkerTop = (category: string | null) => {
    if (!category) return baselineTop
    const headerEl = gridEl.querySelector<HTMLElement>(`[data-category-marker="${category}"]`)
    return headerEl ? headerEl.offsetTop : baselineTop
  }

  const flaggedProjects = projects.value.filter(
    (p) =>
      p.status !== 'avslutad' &&
      p.start_date &&
      p.start_date >= rangeStartISO.value &&
      p.start_date <= rangeEndISO.value &&
      matchesProjectSearch(p.project_number)
  )

  markers.value = flaggedProjects
    .map((p): OverlayMarker | null => {
      const dayIndex = days.value.findIndex((d) => toISO(d) === p.start_date)
      if (dayIndex === -1) return null
      const left = TL_LABEL_WIDTH + dayIndex * TL_DAY_WIDTH
      const top = categoryMarkerTop(p.category)
      const count = p.status === 'planerad' ? myOpenTaskCountForProject(p.id) : 0
      const tip = [
        `${p.project_number} – ${p.name}`,
        p.client ? `Kund: ${p.client}` : '',
        `Preliminär start: ${p.start_date}`,
      ]
        .filter(Boolean)
        .join(' · ')
      return {
        key: `m-${p.id}`,
        left,
        top,
        past: isProjectPast(p),
        label: `${p.project_number} start`,
        tip,
        badge: count > 0 ? taskCountLabel(count) : null,
        projectId: p.id,
      }
    })
    .filter((m): m is OverlayMarker => m !== null)

  const out: OverlayBar[] = []
  for (const resource of visibleResources.value) {
    const firstCell = gridEl.querySelector<HTMLElement>(
      `[data-role="cell"][data-resource="${resource.id}"]`
    )
    if (!firstCell) continue
    const rowTop = firstCell.offsetTop
    const rowHeight = firstCell.offsetHeight
    const baseColor = colorForResource(resource)
    const textColor = readableText(baseColor)
    const rowAssignments = assignments.value.filter(
      (a) =>
        a.resource_id === resource.id &&
        a.start_date <= rangeEndISO.value &&
        a.end_date >= rangeStartISO.value &&
        matchesProjectSearch(a.project_number)
    )
    for (const a of rowAssignments) {
      const startIdx = days.value.findIndex((d) => toISO(d) >= a.start_date)
      let endIdx = -1
      for (let i = days.value.length - 1; i >= 0; i--) {
        if (toISO(days.value[i]!) <= a.end_date) {
          endIdx = i
          break
        }
      }
      if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) continue
      const left = TL_LABEL_WIDTH + startIdx * TL_DAY_WIDTH + 1
      const width = (endIdx - startIdx + 1) * TL_DAY_WIDTH - 2
      const project = projects.value.find((p) => p.id === a.project_id)
      out.push({
        key: `b-${a.id}`,
        left,
        top: rowTop + 3,
        width,
        height: rowHeight - 6,
        bg: shadeForProject(baseColor, a.project_id),
        color: textColor,
        label: `${a.project_number} ${a.project_name}`,
        title: `${a.project_number} – ${a.project_name}`,
        past: isProjectPast(project),
        assignmentId: a.id,
      })
    }
  }
  bars.value = out
}

const overlayDeps = computed(() => [
  tlStart.value,
  filterType.value,
  searchQuery.value,
  showHolidays.value,
  resources.value,
  projects.value,
  assignments.value,
  tasks.value,
])

watch(
  overlayDeps,
  async () => {
    await nextTick()
    computeOverlay()
  },
  { immediate: true }
)
onMounted(() => {
  computeOverlay()
  // Horisontell scroll i tidslinjen: mushjul rullar i sidled när det finns
  // överskott, annars lämnas sidans normala scroll ifred.
  const wrap = wrapRef.value
  if (!wrap) return
  wrap.addEventListener(
    'wheel',
    (e) => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      if (wrap.scrollWidth <= wrap.clientWidth) return
      const atStart = wrap.scrollLeft <= 0 && e.deltaY < 0
      const atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth && e.deltaY > 0
      if (atStart || atEnd) return
      wrap.scrollLeft += e.deltaY
      e.preventDefault()
    },
    { passive: false }
  )
})

// ---------- Toolbar ----------

function prev() {
  tlStart.value = addDays(tlStart.value, -7)
}
function next() {
  tlStart.value = addDays(tlStart.value, 7)
}
function goToday() {
  tlStart.value = mondayOf(new Date())
}

// ---------- Interaktion ----------

function onCellClick(resourceId: number, date: string) {
  openAssignmentModal({ resourceId, date })
}

let dragSuppressClick = false

function onBarClick(assignmentId: number) {
  if (dragSuppressClick) {
    dragSuppressClick = false
    return
  }
  openAssignmentModal({ assignment: assignments.value.find((a) => a.id === assignmentId) ?? null })
}

function startBarDrag(e: PointerEvent, assignmentId: number) {
  if (e.button !== 0) return
  const assignment = assignments.value.find((a) => a.id === assignmentId)
  if (!assignment) return
  const barEl = e.currentTarget as HTMLElement
  const startX = e.clientX
  let moved = false
  try {
    barEl.setPointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX
    if (!moved && Math.abs(dx) > 4) moved = true
    if (moved) barEl.style.transform = `translateX(${dx}px)`
  }
  const onUp = async (ev: PointerEvent) => {
    barEl.removeEventListener('pointermove', onMove)
    barEl.removeEventListener('pointerup', onUp)
    barEl.removeEventListener('pointercancel', onUp)
    barEl.style.transform = ''
    if (!moved) return
    dragSuppressClick = true

    const deltaCols = Math.round((ev.clientX - startX) / TL_DAY_WIDTH)
    if (deltaCols === 0) return

    const foundIdx = days.value.findIndex((d) => toISO(d) >= assignment.start_date)
    const baseIdx = foundIdx === -1 ? 0 : foundIdx
    const targetIdx = Math.min(Math.max(baseIdx + deltaCols, 0), days.value.length - 1)
    let newStart = days.value[targetIdx]!
    let guard = 0
    while (isHoliday(newStart) && guard < 14) {
      newStart = addDays(newStart, deltaCols > 0 ? 1 : -1)
      guard++
    }
    const durationDays = Math.round(
      (fromISO(assignment.end_date).getTime() - fromISO(assignment.start_date).getTime()) / 86400000
    )
    const newEnd = addDays(newStart, durationDays)

    try {
      await api('PUT', `/api/assignments/${assignmentId}`, {
        start_date: toISO(newStart),
        end_date: toISO(newEnd),
      })
      await loadAll()
      toast.add({ title: 'Bokning flyttad' })
    } catch (err) {
      toast.add({ title: (err as Error).message, color: 'error' })
      await loadAll()
    }
  }
  barEl.addEventListener('pointermove', onMove)
  barEl.addEventListener('pointerup', onUp)
  barEl.addEventListener('pointercancel', onUp)
}

// Ändra längd på en bokning genom att dra i vänster-/högerkanten.
// Att dra kanten n rutor förlänger/förkortar planeringen n kalenderdagar.
function startBarResize(e: PointerEvent, assignmentId: number, edge: 'start' | 'end') {
  if (e.button !== 0) return
  const assignment = assignments.value.find((a) => a.id === assignmentId)
  if (!assignment) return
  const handleEl = e.currentTarget as HTMLElement
  const barEl = handleEl.closest('.tl-bar') as HTMLElement | null
  if (!barEl) return

  const startX = e.clientX
  const initLeft = parseFloat(barEl.style.left) || 0
  const initWidth = parseFloat(barEl.style.width) || TL_DAY_WIDTH
  const minW = TL_DAY_WIDTH - 2
  let deltaCols = 0
  let moved = false
  try {
    handleEl.setPointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }

  const reset = () => {
    barEl.style.left = `${initLeft}px`
    barEl.style.width = `${initWidth}px`
  }

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX
    if (!moved && Math.abs(dx) > 3) moved = true
    deltaCols = Math.round(dx / TL_DAY_WIDTH)
    let snap = deltaCols * TL_DAY_WIDTH
    if (edge === 'start') {
      if (initWidth - snap < minW) snap = initWidth - minW
      barEl.style.left = `${initLeft + snap}px`
      barEl.style.width = `${initWidth - snap}px`
    } else {
      if (initWidth + snap < minW) snap = minW - initWidth
      barEl.style.width = `${initWidth + snap}px`
    }
  }

  const onUp = async () => {
    handleEl.removeEventListener('pointermove', onMove)
    handleEl.removeEventListener('pointerup', onUp)
    handleEl.removeEventListener('pointercancel', onUp)
    if (!moved || deltaCols === 0) {
      reset()
      return
    }
    dragSuppressClick = true

    let newStart = assignment.start_date
    let newEnd = assignment.end_date
    if (edge === 'start') {
      let d = addDays(fromISO(assignment.start_date), deltaCols)
      if (d.getTime() > fromISO(assignment.end_date).getTime()) d = fromISO(assignment.end_date)
      newStart = toISO(d)
    } else {
      let d = addDays(fromISO(assignment.end_date), deltaCols)
      if (d.getTime() < fromISO(assignment.start_date).getTime()) d = fromISO(assignment.start_date)
      newEnd = toISO(d)
    }
    if (newStart === assignment.start_date && newEnd === assignment.end_date) {
      reset()
      return
    }

    try {
      await api('PUT', `/api/assignments/${assignmentId}`, {
        start_date: newStart,
        end_date: newEnd,
      })
      await loadAll()
      toast.add({ title: 'Bokningens längd ändrad' })
    } catch (err) {
      toast.add({ title: (err as Error).message, color: 'error' })
      await loadAll()
    }
  }

  handleEl.addEventListener('pointermove', onMove)
  handleEl.addEventListener('pointerup', onUp)
  handleEl.addEventListener('pointercancel', onUp)
}

// Dra i tidslinjalen (vecko-/dagraden) för att panorera i sidled.
function startRulerPan(e: PointerEvent) {
  if (e.button !== 0) return
  if (!(e.target as HTMLElement).closest('.tl-day-header, .tl-week-cell')) return
  const wrap = wrapRef.value
  if (!wrap) return
  e.preventDefault()
  const startX = e.clientX
  const startScroll = wrap.scrollLeft
  wrap.classList.add('tl-panning')
  const onMove = (ev: PointerEvent) => {
    wrap.scrollLeft = startScroll - (ev.clientX - startX)
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    wrap.classList.remove('tl-panning')
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// ---------- Hover-tip för startflaggor ----------
const tip = reactive({ show: false, text: '', left: 0, top: 0 })
function showTip(e: MouseEvent, text: string) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  tip.text = text
  tip.show = true
  nextTick(() => {
    const tipEl = document.querySelector<HTMLElement>('.hover-tip')
    const w = tipEl?.offsetWidth ?? 200
    tip.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8))
    tip.top = r.bottom + 6
  })
}
function hideTip() {
  tip.show = false
}
</script>

<template>
  <section>
    <div class="toolbar">
      <button class="plain" @click="prev">‹ Föregående</button>
      <span class="range-label">{{ rangeLabel }}</span>
      <button class="plain" @click="next">Nästa ›</button>
      <button class="plain" @click="goToday">Idag</button>
      <div class="spacer" />
      <label class="filter-label">Visa:
        <select v-model="filterType">
          <option value="">Alla</option>
          <option value="anstalld">Personal</option>
          <option value="underentreprenor">Underentreprenör</option>
          <option v-for="d in departmentOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
        </select>
      </label>
      <label class="filter-label">Sök projekt:
        <input v-model.trim="searchQuery" type="text" placeholder="Projektnummer...">
      </label>
      <label class="filter-label checkbox-label">
        <input v-model="showHolidays" type="checkbox"> Visa helgdagar
      </label>
      <button class="plain primary" @click="openAssignmentModal({})">+ Boka personal på projekt</button>
    </div>

    <div class="timeline-layout">
      <div ref="wrapRef" class="timeline-wrap" @pointerdown="startRulerPan">
      <div class="timeline-inner">
        <div
          ref="gridRef"
          class="timeline-grid"
          :style="{ gridTemplateColumns: gridCols }"
        >
          <!-- vecko-rad -->
          <div class="tl-week-label" />
          <div
            v-for="(c, i) in weekHeaderCells"
            :key="`w-${i}`"
            class="tl-week-cell"
            :style="{ gridColumn: `span ${c.span}` }"
          >
            v.{{ c.week }}
          </div>

          <!-- dag-rad -->
          <div class="tl-row-label" />
          <div
            v-for="(d, i) in days"
            :key="`d-${i}`"
            class="tl-day-header"
            :class="dayClasses(d)"
            :title="isHoliday(d) ? holidayName(d) : undefined"
          >
            {{ d.getDate() }}<span class="dow">{{ DOW_LABELS[(d.getDay() + 6) % 7] }}</span>
          </div>

          <!-- personalgrupper -->
          <template v-for="group in employeeGroups" :key="`g-${group.category || 'none'}`">
            <template v-if="group.resources.length">
              <div
                class="tl-row-label group-header"
                style="grid-column: 1 / -1"
                :data-category-marker="group.category || 'none'"
              >
                {{ group.label }}
              </div>
              <template v-for="r in group.resources" :key="`r-${r.id}`">
                <div class="tl-row-label">{{ r.name }}</div>
                <div
                  v-for="(d, i) in days"
                  :key="`c-${r.id}-${i}`"
                  class="tl-cell"
                  :class="dayClasses(d)"
                  :title="isHoliday(d) ? holidayName(d) : undefined"
                  data-role="cell"
                  :data-resource="r.id"
                  :data-date="toISO(d)"
                  @click="onCellClick(r.id, toISO(d))"
                />
              </template>
            </template>
          </template>

          <!-- underentreprenörer -->
          <template v-if="subcontractors.length">
            <div class="tl-row-label group-header" style="grid-column: 1 / -1">Underentreprenörer</div>
            <template v-for="r in subcontractors" :key="`sr-${r.id}`">
              <div class="tl-row-label">{{ r.name }}</div>
              <div
                v-for="(d, i) in days"
                :key="`sc-${r.id}-${i}`"
                class="tl-cell"
                :class="dayClasses(d)"
                :title="isHoliday(d) ? holidayName(d) : undefined"
                data-role="cell"
                :data-resource="r.id"
                :data-date="toISO(d)"
                @click="onCellClick(r.id, toISO(d))"
              />
            </template>
          </template>
        </div>

        <div class="timeline-overlay">
          <template v-for="m in markers" :key="m.key">
            <div
              class="tl-start-marker"
              :class="{ 'tl-past': m.past }"
              :style="{ left: m.left + 'px', top: m.top + 'px' }"
            />
            <div
              class="tl-start-flag"
              :class="{ 'tl-past': m.past }"
              :style="{ left: m.left + 'px', top: m.top + 'px' }"
              @mouseenter="showTip($event, m.tip)"
              @mouseleave="hideTip"
            >
              {{ m.label }}
              <span
                v-if="m.badge"
                class="badge planerad task-count-badge"
                @click.stop="goToMyTasksForProject(m.projectId)"
              >{{ m.badge }}</span>
            </div>
          </template>

          <div
            v-for="b in bars"
            :key="b.key"
            class="tl-bar"
            :class="{ 'tl-past': b.past }"
            :style="{
              left: b.left + 'px',
              top: b.top + 'px',
              width: b.width + 'px',
              height: b.height + 'px',
              background: b.bg,
              color: b.color,
            }"
            :title="b.title"
            @click="onBarClick(b.assignmentId)"
            @pointerdown="startBarDrag($event, b.assignmentId)"
          >
            <span
              class="tl-bar-handle tl-bar-handle-start"
              @pointerdown.stop="startBarResize($event, b.assignmentId, 'start')"
            />
            {{ b.label }}
            <span
              class="tl-bar-handle tl-bar-handle-end"
              @pointerdown.stop="startBarResize($event, b.assignmentId, 'end')"
            />
          </div>
        </div>
      </div>
      </div>

      <aside class="tl-unplanned">
        <h3 class="tl-unplanned-title">Ej inplanerade projekt</h3>
        <p v-if="!unplannedProjects.length" class="tl-unplanned-empty">
          Inga aktiva projekt att planera in.
        </p>
        <ul v-else class="tl-unplanned-list">
          <li
            v-for="p in unplannedProjects"
            :key="p.id"
            class="tl-unplanned-item"
            @click="openProjectDetail(p.id)"
          >
            <span class="tl-unplanned-name">{{ p.project_number }} – {{ p.name }}</span>
            <span class="tl-unplanned-meta">
              <span v-if="p.client">{{ p.client }}</span>
              <span v-if="p.start_date">Prel. start {{ p.start_date }}</span>
            </span>
          </li>
        </ul>
      </aside>
    </div>

    <div v-if="tip.show" class="hover-tip" :style="{ left: tip.left + 'px', top: tip.top + 'px' }">
      {{ tip.text }}
    </div>
  </section>
</template>
