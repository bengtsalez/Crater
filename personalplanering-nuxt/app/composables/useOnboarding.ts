import type { OnboardingState } from '~/types'

export const ONBOARDING_STEPS = [
  { key: 'org', label: 'Företag' },
  { key: 'departments', label: 'Avdelningar' },
  { key: 'staff', label: 'Personal' },
  { key: 'projects', label: 'Projekt' },
  { key: 'invites', label: 'Användare' },
  { key: 'done', label: 'Klar' },
] as const

const TOTAL = ONBOARDING_STEPS.length

export function useOnboarding() {
  const { api } = useApi()
  const { loadAll, org } = useAppData()

  const state = useState<Required<OnboardingState>>('onboardingState', () => ({
    step: 1,
    completed: [],
    skipped: [],
  }))

  const current = computed(
    () => ONBOARDING_STEPS[state.value.step - 1] ?? ONBOARDING_STEPS[0]
  )
  const isFirst = computed(() => state.value.step === 1)
  const isLast = computed(() => state.value.step === TOTAL)

  // Läs in sparat framsteg från organizations.onboarding_state.
  function hydrate() {
    const saved = org.value?.onboarding_state
    if (saved && typeof saved.step === 'number') {
      state.value = {
        step: Math.min(Math.max(saved.step, 1), TOTAL),
        completed: saved.completed ?? [],
        skipped: saved.skipped ?? [],
      }
    }
  }

  async function persist() {
    await api('PUT', '/api/onboarding', { state: state.value })
  }

  async function goTo(step: number) {
    state.value.step = Math.min(Math.max(step, 1), TOTAL)
    await persist()
  }

  async function next() {
    if (!state.value.completed.includes(state.value.step)) {
      state.value.completed.push(state.value.step)
    }
    state.value.skipped = state.value.skipped.filter((s) => s !== state.value.step)
    await goTo(state.value.step + 1)
  }

  async function skip() {
    if (!state.value.skipped.includes(state.value.step)) {
      state.value.skipped.push(state.value.step)
    }
    await goTo(state.value.step + 1)
  }

  async function back() {
    await goTo(state.value.step - 1)
  }

  async function complete() {
    await api('POST', '/api/onboarding/complete')
    await loadAll()
    await navigateTo('/')
  }

  return {
    steps: ONBOARDING_STEPS,
    total: TOTAL,
    state,
    current,
    isFirst,
    isLast,
    hydrate,
    persist,
    goTo,
    next,
    skip,
    back,
    complete,
  }
}
