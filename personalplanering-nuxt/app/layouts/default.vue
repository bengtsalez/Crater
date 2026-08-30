<script setup lang="ts">
import type { TabName } from '~/composables/useUiState'

const route = useRoute()
const { activeTab, projectDetailId } = useUiState()
const { org } = useAppData()
const { api } = useApi()

const isLogin = computed(() => route.path === '/login')
const appTitle = computed(() => org.value?.app_title || org.value?.name || 'Personalplanering')
useHead(() => ({ title: appTitle.value }))

const tabs: { name: TabName; label: string; hidden?: boolean }[] = [
  { name: 'timeline', label: 'Tidslinje' },
  { name: 'analytics', label: 'Översikt' },
  { name: 'month', label: 'Månadskalender', hidden: true },
  { name: 'projects', label: 'Projekt' },
  { name: 'resources', label: 'Personal' },
  { name: 'minsida', label: 'Min sida' },
]

function selectTab(name: TabName) {
  projectDetailId.value = null
  activeTab.value = name
}

async function logout() {
  await api('POST', '/api/logout')
  await navigateTo('/login')
}
</script>

<template>
  <div>
    <header v-if="!isLogin" class="topbar">
      <h1>{{ appTitle }}</h1>
      <nav class="tabs">
        <button
          v-for="t in tabs"
          v-show="!t.hidden"
          :key="t.name"
          class="tab-btn"
          :class="{ active: activeTab === t.name && projectDetailId === null }"
          @click="selectTab(t.name)"
        >
          {{ t.label }}
        </button>
      </nav>
      <div class="spacer" />
      <button class="plain" @click="logout()">Logga ut</button>
    </header>

    <main :class="isLogin ? '' : 'app-main'">
      <slot />
    </main>
  </div>
</template>
