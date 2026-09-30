<script setup lang="ts">
import type { Me } from '~/types'

// Förenklat skal för personalvyn: titel, "Mina arbeten" och Logga ut.
// Inga interna flikar och ingen intern data.
const me = useState<Me | null>('emp:me', () => null)
const route = useRoute()
const appTitle = computed(() => me.value?.org?.app_title || me.value?.org?.name || 'Personalplanering')
useHead(() => ({ title: `Mina arbeten – ${appTitle.value}` }))

const onList = computed(() => route.path === '/personal')
</script>

<template>
  <div class="emp-shell">
    <header class="topbar emp-topbar">
      <NuxtLink to="/personal" class="emp-brand">{{ appTitle }}</NuxtLink>
      <div class="spacer" />
      <NuxtLink v-if="!onList" to="/personal" class="emp-nav-link">Mina arbeten</NuxtLink>
      <button class="plain" @click="logoutAndReset('/personal/login')">Logga ut</button>
    </header>
    <main class="emp-main">
      <slot />
    </main>
  </div>
</template>
