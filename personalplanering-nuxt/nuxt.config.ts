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

  // DATABASE_URL och JWT_SECRET läses direkt via process.env i server/utils/{db,auth}.ts
  // vid runtime – de får INTE bäddas in i bunten (Netlifys secrets-scan stoppar bygget).

  // Nitro auto-detects Netlify in CI; keep server routes under /server/api.
  nitro: {
    preset: process.env.NITRO_PRESET || undefined,
  },

  typescript: {
    strict: true,
  },
})
