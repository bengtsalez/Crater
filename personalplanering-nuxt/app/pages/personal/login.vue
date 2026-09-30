<script setup lang="ts">
definePageMeta({ layout: 'blank' })
useHead({ title: 'Personalinloggning' })
</script>

<template>
  <LoginForm title="Personalinloggning">
    <p class="login-alt">Logga in för att se dina arbeten och uppgifter.</p>
    <p class="login-alt">
      Projektledare eller kontor? <NuxtLink to="/login">Logga in här</NuxtLink>
    </p>
  </LoginForm>
</template>
