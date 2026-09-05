import { defineConfig } from 'vitest/config'

// Enhetstester för ren affärslogik (app/utils). Ingen Nuxt/Vue-runtime behövs –
// analytics.ts importerar bara relativa moduler.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['app/**/*.spec.ts'],
  },
})
