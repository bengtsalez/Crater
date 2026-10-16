<script setup lang="ts">
import type { AttachmentView } from '../../../shared/inspectionTypes'

// Bilder hämtas via serverns autentiserade route som svarar med en
// kortlivad signerad adress – lagringsnycklar exponeras aldrig.
defineProps<{ photos: AttachmentView[]; base: string; canRemove?: boolean }>()
const emit = defineEmits<{ remove: [id: string] }>()
const zoom = ref<string | null>(null)
function remove(id: string) {
  if (confirm('Ta bort bilden?')) emit('remove', id)
}
</script>

<template>
  <div v-if="photos.length" class="ik-photo-grid">
    <div v-for="p in photos" :key="p.id" class="ik-photo">
      <button type="button" class="ik-photo-btn" :title="`Uppladdad av ${p.uploaded_by_name ?? '–'}`" @click="zoom = p.id">
        <img :src="`${base}/attachments/${p.id}`" alt="Foto" loading="lazy">
      </button>
      <button v-if="canRemove" type="button" class="plain icon-btn danger ik-photo-remove" title="Ta bort bild" @click="remove(p.id)">
        <UIcon name="i-lucide-x" />
      </button>
    </div>
    <UModal :open="!!zoom" title="Foto" @update:open="(v: boolean) => { if (!v) zoom = null }">
      <template #body>
        <img v-if="zoom" :src="`${base}/attachments/${zoom}`" alt="Foto" class="ik-photo-full">
      </template>
    </UModal>
  </div>
</template>
