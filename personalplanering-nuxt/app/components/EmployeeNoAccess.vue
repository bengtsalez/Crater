<script setup lang="ts">
defineProps<{ message: string }>()
</script>

<template>
  <div class="emp-notice" role="alert">
    <UIcon name="i-lucide-link-2-off" class="emp-notice-icon" />
    <h2>Kontot saknar koppling</h2>
    <p>{{ message }}</p>
    <button class="plain primary emp-btn" @click="logoutAndReset('/personal/login')">Logga ut</button>
  </div>
</template>
