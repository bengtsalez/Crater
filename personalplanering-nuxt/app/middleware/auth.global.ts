import type { Me } from '~/types'

const PUBLIC_PATHS = new Set(['/login', '/signup', '/personal/login', '/redovisning/login'])

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return
  if (PUBLIC_PATHS.has(to.path)) return

  const onPersonal = isPersonalPath(to.path)
  const onAccountant = isAccountantPath(to.path)

  let me: Me
  try {
    me = await $fetch<Me>('/api/me')
  } catch (err) {
    const status =
      (err as { status?: number; statusCode?: number })?.status ??
      (err as { statusCode?: number })?.statusCode
    if (status === 401) {
      resetClientState()
      return navigateTo(loginPathFor(to.path))
    }
    // Andra fel (t.ex. DB nere) – låt sidan rendera och visa sitt eget fel.
    return
  }

  // Annat konto än det som ligger i cachen (utloggning/inloggning i samma
  // flik, eller sessionen bytt i en annan flik) → rensa allt först.
  const cached = useState<Me | null>('currentUser', () => null)
  const cachedEmployeeId = useState<number | null>('emp:userId', () => null)
  const previousId = cached.value?.id ?? cachedEmployeeId.value
  if (previousId !== null && previousId !== undefined && previousId !== me.id) resetClientState()

  // Personal: bara den förenklade personalvyn. Ingen onboarding.
  if (me.role === 'employee') {
    useState<number | null>('emp:userId', () => null).value = me.id
    useState<Me | null>('emp:me', () => null).value = me
    if (!onPersonal) return navigateTo('/personal')
    return
  }

  // Redovisningskonsult: bara den skrivskyddade redovisningsvyn. Ingen onboarding.
  if (me.role === 'accountant') {
    // 'emp:userId' bär id:t för alla begränsade konton (kontobyte-kollen ovan).
    useState<number | null>('emp:userId', () => null).value = me.id
    useState<Me | null>('acc:me', () => null).value = me
    if (!onAccountant) return navigateTo('/redovisning')
    return
  }

  // Interna användare behåller sitt flöde och hör inte hemma i personal-/redovisningsvyn.
  if (onPersonal || onAccountant) return navigateTo('/')

  const onboarded = Boolean(me.org?.onboarded_at)
  const onOnboarding = to.path === '/onboarding' || to.path.startsWith('/onboarding/')
  if (!onboarded && !onOnboarding) return navigateTo('/onboarding')
  if (onboarded && onOnboarding) return navigateTo('/')
})
