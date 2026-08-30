import type { Me } from '~/types'

const PUBLIC_PATHS = new Set(['/login', '/signup'])

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return
  if (PUBLIC_PATHS.has(to.path)) return

  let me: Me
  try {
    me = await $fetch<Me>('/api/me')
  } catch (err) {
    const status =
      (err as { status?: number; statusCode?: number })?.status ??
      (err as { statusCode?: number })?.statusCode
    if (status === 401) return navigateTo('/login')
    // Andra fel (t.ex. DB nere) – låt sidan rendera och visa sitt eget fel.
    return
  }

  const onboarded = Boolean(me.org?.onboarded_at)
  const onOnboarding = to.path === '/onboarding' || to.path.startsWith('/onboarding/')
  if (!onboarded && !onOnboarding) return navigateTo('/onboarding')
  if (onboarded && onOnboarding) return navigateTo('/')
})
