<script setup lang="ts">
const username = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    await $fetch('/api/login', {
      method: 'POST',
      body: { username: username.value, password: password.value },
    })
    await navigateTo('/')
  } catch (err) {
    const data = (err as { data?: { error?: string } })?.data
    error.value = data?.error || 'Kunde inte logga in.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <form class="login-card" novalidate @submit.prevent="submit">
      <h1>Personalplanering</h1>
      <label for="username">Användarnamn</label>
      <input
        id="username"
        v-model="username"
        type="text"
        autocomplete="username"
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
      <p class="login-alt">
        Nytt företag? <NuxtLink to="/signup">Skapa konto</NuxtLink>
      </p>
    </form>
  </div>
</template>
