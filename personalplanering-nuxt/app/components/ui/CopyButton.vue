<script setup lang="ts">
// Native <select> går inte att markera i – den här knappen kopierar valt värde.
const props = defineProps<{ text: string }>()

const toast = useToast()

async function copy() {
  if (!props.text) return
  try {
    await navigator.clipboard.writeText(props.text)
    toast.add({ title: 'Kopierat', color: 'success' })
  } catch {
    toast.add({ title: 'Kunde inte kopiera', color: 'error' })
  }
}
</script>

<template>
  <button
    type="button"
    class="plain ghost icon-btn"
    title="Kopiera"
    aria-label="Kopiera"
    :disabled="!text"
    @click="copy"
  >
    <UIcon name="i-lucide-copy" />
  </button>
</template>
