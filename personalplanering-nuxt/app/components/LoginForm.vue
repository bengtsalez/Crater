<script setup lang="ts">
// Gemensamt inloggningsformulär för /login (interna användare),
// /personal/login (personal) och /redovisning/login (redovisningskonsult).
// Samma /api/login – rollen i svaret avgör vart man hamnar, så även en
// anställd som råkar använda /login landar rätt.
defineProps<{ title: string }>()

const username = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    const res = await $fetch<{ ok: boolean; role?: string }>('/api/login', {
      method: 'POST',
      body: { username: username.value, password: password.value },
    })
    // Nytt konto i samma flik → släng allt som tidigare användare laddat.
    resetClientState()
    await navigateTo(homePathForRole(res.role))
  } catch (err) {
    error.value = errorMessage(err, 'Kunde inte logga in.')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <form class="login-card" novalidate @submit.prevent="submit">
      <h1>{{ title }}</h1>
      <label for="username">Användarnamn</label>
      <input
        id="username"
        v-model="username"
        type="text"
        autocomplete="username"
        autocapitalize="none"
        required
        autofocus
      >
      <label for="password">Lösenord</label>
      <input
        id="password"
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
      >
      <div class="error">{{ error }}</div>
      <button type="submit" :disabled="submitting">Logga in</button>
      <slot />
    </form>
  </div>
</template>
