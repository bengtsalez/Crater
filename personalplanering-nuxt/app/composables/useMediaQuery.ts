/**
 * Reaktiv `matchMedia` – ger en `Ref<boolean>` som uppdateras när media-frågan
 * ändras. Appen är SPA (`ssr: false`) men vi vaktar ändå på `import.meta.client`
 * så komponenter kan anropa den utan att krascha under prerender.
 */
export function useMediaQuery(query: string) {
  const matches = ref(false)

  if (import.meta.client) {
    const mql = window.matchMedia(query)
    matches.value = mql.matches
    const onChange = (e: MediaQueryListEvent) => {
      matches.value = e.matches
    }
    mql.addEventListener('change', onChange)
    onScopeDispose(() => mql.removeEventListener('change', onChange))
  }

  return matches
}

/** Samma brytpunkt som `@media (max-width: 767px)` i main.css. */
export function useIsMobile() {
  return useMediaQuery('(max-width: 767px)')
}
