<script setup lang="ts">
definePageMeta({ layout: 'blank' })
useHead({ title: 'Inloggning redovisning' })
</script>

<template>
  <LoginForm title="Inloggning redovisning">
    <p class="login-alt">Logga in för att se projekt och kunduppgifter.</p>
    <p class="login-alt">
      Projektledare eller kontor? <NuxtLink to="/login">Logga in här</NuxtLink>
    </p>
  </LoginForm>
</template>
