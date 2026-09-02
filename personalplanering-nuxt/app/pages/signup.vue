<script setup lang="ts">
definePageMeta({ layout: 'blank' })

const companyName = ref('')
const adminUsername = ref('')
const adminEmail = ref('')
const password = ref('')
const website = ref('') // honeypot – lämnas tomt av människor
const error = ref('')
const submitting = ref(false)

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    await $fetch('/api/signup', {
      method: 'POST',
      body: {
        company_name: companyName.value,
        admin_username: adminUsername.value,
        admin_email: adminEmail.value,
        password: password.value,
        website: website.value,
      },
    })
    await navigateTo('/onboarding')
  } catch (err) {
    error.value = errorMessage(err, 'Kunde inte skapa konto.')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <form class="login-card" novalidate @submit.prevent="submit">
      <h1>Skapa konto</h1>
      <p class="signup-lead">Kom igång med personalplanering för ditt företag.</p>

      <label for="company">Företagsnamn</label>
      <input id="company" v-model="companyName" type="text" required autofocus>

      <label for="username">Användarnamn (admin)</label>
      <input id="username" v-model="adminUsername" type="text" autocomplete="username" required>

      <label for="email">E-post</label>
      <input id="email" v-model="adminEmail" type="email" autocomplete="email" required>

      <label for="password">Lösenord (minst 8 tecken)</label>
      <input id="password" v-model="password" type="password" autocomplete="new-password" required>

      <div class="hp-field" aria-hidden="true">
        <label for="website">Webbplats</label>
        <input id="website" v-model="website" type="text" tabindex="-1" autocomplete="off">
      </div>

      <div class="error">{{ error }}</div>
      <button type="submit" :disabled="submitting">Skapa konto</button>

      <p class="signup-alt">
        Har du redan ett konto? <NuxtLink to="/login">Logga in</NuxtLink>
      </p>
    </form>
  </div>
</template>

<style scoped>
.signup-lead {
  margin: -0.25rem 0 0.75rem;
  color: var(--muted, #667085);
  font-size: 0.9rem;
}
.signup-alt {
  margin-top: 1rem;
  font-size: 0.9rem;
  text-align: center;
}
.hp-field {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
</style>
