// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  // SPA – som den gamla appen. All datahämtning sker i webbläsaren med sessionskakan.
  ssr: false,

  modules: ['@nuxt/ui'],

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'sv' },
      title: 'Personalplanering',
      meta: [
        { charset: 'UTF-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },

  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
  },

  // Nitro auto-detects Netlify in CI; keep server routes under /server/api.
  nitro: {
    preset: process.env.NITRO_PRESET || undefined,
  },

  typescript: {
    strict: true,
  },
})
