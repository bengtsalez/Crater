<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ default: '' })

const inputRef = ref<HTMLInputElement | null>(null)

function openPicker() {
  inputRef.value?.showPicker?.()
}
</script>

<template>
  <div class="date-field">
    <input ref="inputRef" v-model="model" type="date" v-bind="$attrs">
    <UIcon name="i-lucide-calendar" class="date-field-icon" @click="openPicker" />
  </div>
</template>
