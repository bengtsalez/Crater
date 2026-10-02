<script setup lang="ts">
import type { Me } from '~/types'

// Skal för redovisningsvyn: titel, "Projekt" och Logga ut. Inga interna flikar.
const me = useState<Me | null>('acc:me', () => null)
const route = useRoute()
const appTitle = computed(() => me.value?.org?.app_title || me.value?.org?.name || 'Personalplanering')
useHead(() => ({ title: `Redovisning – ${appTitle.value}` }))

const onList = computed(() => route.path === '/redovisning')
</script>

<template>
  <div class="emp-shell">
    <header class="topbar emp-topbar">
      <NuxtLink to="/redovisning" class="emp-brand">{{ appTitle }} · Redovisning</NuxtLink>
      <div class="spacer" />
      <NuxtLink v-if="!onList" to="/redovisning" class="emp-nav-link">Alla projekt</NuxtLink>
      <span class="emp-muted acc-user">{{ me?.username }}</span>
      <button class="plain" @click="logoutAndReset('/redovisning/login')">Logga ut</button>
    </header>
    <main class="emp-main acc-main">
      <slot />
    </main>
  </div>
</template>
