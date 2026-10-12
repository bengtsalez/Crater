<script setup lang="ts">
const { org } = useAppData()

const BUY_BUTTON_ID = 'buy_btn_1UNt5qEzilw0xT3x3wNktMwG'
const PUBLISHABLE_KEY =
  'pk_live_51QzeyzEzilw0xT3x5UNV4IH4BpbzMXvS9QITNkhYHqLDP7Gr3bd6F9COrxKRUW7s6QecQf8TX3zz060QBXuC4gqM00vG7nMyzT'

useHead({
  script: [{ src: 'https://js.stripe.com/v3/buy-button.js', async: true }],
})

// Betalningen verifieras inte här än – steget går att hoppa över så länge
// PAYMENT_REQUIRED i pages/onboarding.vue är false.
// eslint-disable-next-line @typescript-eslint/require-await
async function save(): Promise<boolean> {
  return true
}
defineExpose({ save })
</script>

<template>
  <div class="ob-step">
    <h2>Betalning</h2>
    <p class="ob-step-lead">
      Välj abonnemang för {{ org?.app_title || org?.name }}. Betalningen sker via Stripe.
    </p>

    <stripe-buy-button
      :buy-button-id="BUY_BUTTON_ID"
      :publishable-key="PUBLISHABLE_KEY"
      :client-reference-id="org ? `org_${org.id}` : undefined"
    />
  </div>
</template>
