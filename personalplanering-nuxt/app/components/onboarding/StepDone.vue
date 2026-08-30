<script setup lang="ts">
const { resources, projects, users, departments, org } = useAppData()
const { complete } = useOnboarding()
const toast = useToast()

async function save(): Promise<boolean> {
  try {
    await complete()
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
    <h2>Klart att börja</h2>
    <p class="ob-step-lead">
      {{ org?.app_title || org?.name }} är uppsatt. Du kan alltid ändra allt inne i appen.
    </p>
    <ul class="ob-summary">
      <li><strong>{{ departments.length }}</strong> avdelningar</li>
      <li><strong>{{ resources.length }}</strong> personal</li>
      <li><strong>{{ projects.length }}</strong> projekt</li>
      <li><strong>{{ users.length }}</strong> användare</li>
    </ul>
  </div>
</template>
