<script setup lang="ts">
import { ANSWER_TYPE_LABELS, ANSWER_TYPES, newItemKey, type TemplateItem, type TemplateSection } from '../../../shared/inspections'

// Enkel mallbyggare: avsnitt och kontrollpunkter kan läggas till, flyttas
// upp/ner, dupliceras och tas bort. Används både för företagets mallar och
// för projektanpassning av en kontroll innan arbetet påbörjats.
const sections = defineModel<TemplateSection[]>({ required: true })
const open = ref<string | null>(null)

function blankItem(): TemplateItem {
  return {
    key: newItemKey(),
    title: '',
    instruction: null,
    basis: null,
    basis_url: null,
    method: null,
    answer_type: 'result',
    unit: null,
    required: true,
    min_photos: 0,
    comment_required: false,
    critical: false,
    timing_note: null,
  }
}

function move<T>(arr: T[], i: number, d: number) {
  const j = i + d
  if (j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
}

function addSection() {
  sections.value.push({ title: '', items: [blankItem()] })
  open.value = sections.value.at(-1)!.items[0]!.key
}
function duplicateSection(i: number) {
  const s = sections.value[i]!
  sections.value.splice(i + 1, 0, { title: `${s.title} (kopia)`, items: s.items.map((it) => ({ ...it, key: newItemKey() })) })
}
function removeSection(i: number) {
  const s = sections.value[i]!
  if (s.items.length && !confirm(`Ta bort avsnittet "${s.title || 'utan rubrik'}" och dess ${s.items.length} punkter?`)) return
  sections.value.splice(i, 1)
}
function addItem(s: TemplateSection) {
  const it = blankItem()
  s.items.push(it)
  open.value = it.key
}
function duplicateItem(s: TemplateSection, i: number) {
  const it = { ...s.items[i]!, key: newItemKey(), title: `${s.items[i]!.title} (kopia)` }
  s.items.splice(i + 1, 0, it)
  open.value = it.key
}
function toggle(key: string) {
  open.value = open.value === key ? null : key
}
const nullable = (v: string) => (v.trim() ? v : null)
</script>

<template>
  <div class="ik-editor">
    <p v-if="!sections.length" class="empty-state">Inga avsnitt ännu. Lägg till ett avsnitt för att börja.</p>
    <div v-for="(s, si) in sections" :key="si" class="ik-ed-section">
      <div class="ik-ed-section-head">
        <input v-model="s.title" class="ik-ed-section-title" placeholder="Avsnittets rubrik, t.ex. Före start" aria-label="Avsnittets rubrik">
        <div class="ik-ed-tools">
          <button type="button" class="plain icon-btn" title="Flytta upp" :disabled="si === 0" @click="move(sections, si, -1)"><UIcon name="i-lucide-arrow-up" /></button>
          <button type="button" class="plain icon-btn" title="Flytta ner" :disabled="si === sections.length - 1" @click="move(sections, si, 1)"><UIcon name="i-lucide-arrow-down" /></button>
          <button type="button" class="plain icon-btn" title="Duplicera avsnitt" @click="duplicateSection(si)"><UIcon name="i-lucide-copy" /></button>
          <button type="button" class="plain icon-btn danger" title="Ta bort avsnitt" @click="removeSection(si)"><UIcon name="i-lucide-trash-2" /></button>
        </div>
      </div>

      <div v-for="(it, ii) in s.items" :key="it.key" class="ik-ed-item" :class="{ open: open === it.key }">
        <div class="ik-ed-item-head">
          <button type="button" class="ik-ed-item-toggle" :aria-expanded="open === it.key" @click="toggle(it.key)">
            <UIcon :name="open === it.key ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
            <span :class="{ 'ik-muted': !it.title }">{{ it.title || 'Ny kontrollpunkt' }}</span>
            <span class="ik-ed-tags">
              <span class="ik-tag">{{ ANSWER_TYPE_LABELS[it.answer_type] }}</span>
              <span v-if="it.required" class="ik-tag">Obligatorisk</span>
              <span v-if="it.min_photos" class="ik-tag">{{ it.min_photos }} foto</span>
              <span v-if="it.critical" class="ik-tag critical">Kritiskt</span>
            </span>
          </button>
          <div class="ik-ed-tools">
            <button type="button" class="plain icon-btn" title="Flytta upp" :disabled="ii === 0" @click="move(s.items, ii, -1)"><UIcon name="i-lucide-arrow-up" /></button>
            <button type="button" class="plain icon-btn" title="Flytta ner" :disabled="ii === s.items.length - 1" @click="move(s.items, ii, 1)"><UIcon name="i-lucide-arrow-down" /></button>
            <button type="button" class="plain icon-btn" title="Duplicera punkt" @click="duplicateItem(s, ii)"><UIcon name="i-lucide-copy" /></button>
            <button type="button" class="plain icon-btn danger" title="Ta bort punkt" @click="s.items.splice(ii, 1)"><UIcon name="i-lucide-trash-2" /></button>
          </div>
        </div>
        <div v-if="open === it.key" class="pp-form ik-ed-item-body">
          <label>Rubrik *<input v-model="it.title" required maxlength="300"></label>
          <label>Instruktion<textarea :value="it.instruction ?? ''" rows="2" @input="it.instruction = nullable(($event.target as HTMLTextAreaElement).value)" /></label>
          <div class="row-2">
            <label>Kontrollunderlag<input :value="it.basis ?? ''" placeholder="t.ex. Ritning A-101, systemanvisning" @input="it.basis = nullable(($event.target as HTMLInputElement).value)"></label>
            <label>Länk till underlag<input :value="it.basis_url ?? ''" type="url" placeholder="https://…" @input="it.basis_url = nullable(($event.target as HTMLInputElement).value)"></label>
          </div>
          <div class="row-2">
            <label>Kontrollmetod<input :value="it.method ?? ''" placeholder="t.ex. Visuell kontroll, mätning" @input="it.method = nullable(($event.target as HTMLInputElement).value)"></label>
            <label>När ska kontrollen utföras<input :value="it.timing_note ?? ''" placeholder="t.ex. Innan återfyllning" @input="it.timing_note = nullable(($event.target as HTMLInputElement).value)"></label>
          </div>
          <div class="row-2">
            <label>Svarstyp
              <select v-model="it.answer_type">
                <option v-for="t in ANSWER_TYPES" :key="t" :value="t">{{ ANSWER_TYPE_LABELS[t] }}</option>
              </select>
            </label>
            <label v-if="it.answer_type === 'number'">Enhet<input :value="it.unit ?? ''" placeholder="t.ex. mm, m, %" maxlength="30" @input="it.unit = nullable(($event.target as HTMLInputElement).value)"></label>
            <label>Minsta antal bilder<input v-model.number="it.min_photos" type="number" min="0" max="20"></label>
          </div>
          <div class="ik-ed-checks">
            <label class="checkbox-label"><input v-model="it.required" type="checkbox"> Obligatoriskt svar</label>
            <label class="checkbox-label"><input v-model="it.comment_required" type="checkbox"> Kommentar krävs</label>
            <label class="checkbox-label"><input v-model="it.critical" type="checkbox"> Kritiskt moment</label>
          </div>
        </div>
      </div>
      <button type="button" class="plain ghost ik-ed-add" @click="addItem(s)">+ Kontrollpunkt</button>
    </div>
    <button type="button" class="plain" @click="addSection">+ Avsnitt</button>
  </div>
</template>
