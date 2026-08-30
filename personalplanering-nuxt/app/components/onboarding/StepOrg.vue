<script setup lang="ts">
const { api } = useApi()
const { org, loadAll } = useAppData()
const toast = useToast()

const form = reactive({
  name: org.value?.name ?? '',
  app_title: org.value?.app_title ?? '',
})

watchEffect(() => {
  if (org.value && !form.name) form.name = org.value.name
})

async function save(): Promise<boolean> {
  const name = form.name.trim()
  if (name.length < 2) {
    toast.add({ title: 'Ange ett företagsnamn.', color: 'error' })
    return false
  }
  try {
    await api('PUT', '/api/org', {
      name,
      app_title: form.app_title.trim() || name,
    })
    await loadAll()
    return true
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
    return false
  }
}

defineExpose({ save })
</script>

<template>
  <div class="ob-step">
    <h2>Ditt företag</h2>
    <p class="ob-step-lead">Namnet visas i appens rubrik och kan ändras senare.</p>
    <form class="pp-form" @submit.prevent>
      <label>Företagsnamn *
        <input v-model="form.name" required>
      </label>
      <label>Rubrik i appen
        <input v-model="form.app_title" :placeholder="form.name || 'Personalplanering'">
      </label>
    </form>
  </div>
</template>
