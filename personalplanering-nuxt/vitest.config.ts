import { defineConfig } from 'vitest/config'

// Enhetstester för ren affärslogik utan runtime-beroenden: app/utils
// (Nuxt/Vue-fritt) och server/utils (Nitro-fritt – filer här får INTE
// importera något som rör vid Nitros auto-imports, t.ex. apiError/createError).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['app/**/*.spec.ts', 'server/**/*.spec.ts'],
  },
})
