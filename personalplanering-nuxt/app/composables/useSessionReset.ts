import type { LoginPath } from '~/utils/roles'

/**
 * Rensar all klientcache och stoppar polling. Körs vid utloggning, inloggning
 * och när ett annat konto upptäcks (t.ex. utloggning + inloggning som någon
 * annan i samma flik) – så att varken intern data eller en tidigare
 * användares arbeten ligger kvar i minnet.
 */
export function resetClientState() {
  useAppData().stopPolling()
  useEmployeeData().stopPolling()
  clearNuxtState()
}

export async function logoutAndReset(target: LoginPath = '/login') {
  try {
    await $fetch('/api/logout', { method: 'POST' })
  } finally {
    resetClientState()
    await navigateTo(target)
  }
}
