<script setup lang="ts">
import OnboardingProgress from '~/components/onboarding/OnboardingProgress.vue'
import StepOrg from '~/components/onboarding/StepOrg.vue'
import StepDepartments from '~/components/onboarding/StepDepartments.vue'
import StepStaff from '~/components/onboarding/StepStaff.vue'
import StepProjects from '~/components/onboarding/StepProjects.vue'
import StepInvites from '~/components/onboarding/StepInvites.vue'
import StepDone from '~/components/onboarding/StepDone.vue'

definePageMeta({ layout: 'blank' })

const { loadAll } = useAppData()
const ob = useOnboarding()
const toast = useToast()

const stepRef = ref<{ save: () => Promise<boolean> } | null>(null)
const pending = ref(true)
const busy = ref(false)

const STEP_COMPONENTS: Record<string, unknown> = {
  org: StepOrg,
  departments: StepDepartments,
  staff: StepStaff,
  projects: StepProjects,
  invites: StepInvites,
  done: StepDone,
}

const stepComponent = computed(() => STEP_COMPONENTS[ob.current.value.key])
const SKIPPABLE = new Set(['departments', 'staff', 'projects', 'invites'])
const canSkip = computed(() => SKIPPABLE.has(ob.current.value.key))

onMounted(async () => {
  try {
    await loadAll()
    ob.hydrate()
  } catch (err) {
    toast.add({ title: (err as Error).message, color: 'error' })
  } finally {
    pending.value = false
  }
})

async function onNext() {
  if (busy.value) return
  busy.value = true
  try {
    const ok = (await stepRef.value?.save()) ?? true
    if (ok && !ob.isLast.value) await ob.next()
  } finally {
    busy.value = false
  }
}

async function onSkip() {
  if (busy.value) return
  busy.value = true
  try {
    await ob.skip()
  } finally {
    busy.value = false
  }
}

async function onBack() {
  if (busy.value || ob.isFirst.value) return
  busy.value = true
  try {
    await ob.back()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="ob-page">
    <div class="ob-card">
      <h1 class="ob-title">Kom igång</h1>

      <p v-if="pending" class="empty-state">Laddar…</p>

      <template v-else>
        <OnboardingProgress
          :step="ob.state.value.step"
          :completed="ob.state.value.completed"
          :skipped="ob.state.value.skipped"
          @go="ob.goTo"
        />

        <component :is="stepComponent" ref="stepRef" />

        <div class="ob-nav">
          <button
            v-if="!ob.isFirst.value"
            type="button"
            class="plain ghost"
            :disabled="busy"
            @click="onBack"
          >
            Tillbaka
          </button>
          <div class="spacer" />
          <button
            v-if="canSkip"
            type="button"
            class="plain ghost"
            :disabled="busy"
            @click="onSkip"
          >
            Hoppa över
          </button>
          <button
            type="button"
            class="plain primary"
            :disabled="busy"
            @click="onNext"
          >
            {{ ob.isLast.value ? 'Slutför' : 'Nästa' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
