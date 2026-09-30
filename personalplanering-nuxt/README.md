# Personalplanering (Nuxt)

**Nuxt 4 + Nuxt UI 4 + Nitro**, i TypeScript. Ursprungligen en omskrivning av den gamla
vanilla-JS + Express-appen (`personalplanering/`, borttagen 2026-09-02); samma databas
och samma API-kontrakt lever kvar.

## Stack

- **Nuxt 4**, `ssr: false` (SPA – som gamla appen)
- **Nuxt UI 4** – används för modaler (`UModal`); resten av UI:t är egna komponenter med
  porterad CSS (`app/assets/css/main.css`) för att bevara utseendet
- **Nitro server routes** under `server/api/**` ersätter Express 1:1
- **Postgres via `pg`** – `server/utils/db.ts` (identiskt schema-bootstrap med gamla `db.js`)
- **Auth**: JWT i httpOnly-cookie `session`, bcrypt – `server/utils/auth.ts` +
  `server/middleware/auth.ts`

## Köra lokalt

```bash
npm install
# .env behöver DATABASE_URL + JWT_SECRET (hämtas från Netlify-sitens env-vars)
npm run dev          # http://localhost:3001  (PORT i .env)
```

Övriga script:

```bash
npm run build        # produktion (Nitro upptäcker Netlify i CI automatiskt)
npm run typecheck
npm run set-user -- <användarnamn> <lösenord>   # skapa/uppdatera användare
npm run test         # enhets- + DB-integrationstester (PGlite, ingen extern DB)
npm run test:e2e     # bygger + HTTP-e2e för personalvyn mot PGlite
```

`DATABASE_SSL=false` stänger av TLS mot databasen. Den används bara för lokala
testdatabaser (e2e). Standard är oförändrad.

**Personalvy:** personal loggar in på `/personal/login`. Se `../docs/employee-access.md`
för roller, koppling konto ↔ personalresurs och behörigheter.

## Struktur

| Sökväg | Roll |
|---|---|
| `server/api/**` | REST-endpoints (samma som gamla appen) |
| `server/utils/{db,auth,domain,queries,http}.ts` | delad serverlogik |
| `server/middleware/auth.ts` | skyddar `/api/**` utom `/api/login`, `/api/logout`; läser användaren från DB per anrop; personal bara `/api/employee/**` |
| `server/api/employee/**`, `server/utils/employeeAccess.ts` | personalvyns begränsade API |
| `app/pages/personal/**`, `layouts/employee.vue`, `useEmployeeData.ts` | personalvyn |
| `app/composables/useAppData.ts` | delad datacache + `loadAll()` (motsvarar gamla `state`) |
| `app/composables/useApi.ts` | `$fetch`-wrapper (401 → `/login`, fel → svensk text) |
| `app/composables/useModals.ts` | öppna/stäng-tillstånd för alla modaler |
| `app/composables/useUiState.ts` | flikval, projektdetalj, "Min sida"-filter |
| `app/components/TheTimeline.vue` | tidslinjen (rutnät, veckonr, helgdagar, drag & drop) |
| `app/components/*Panel.vue`, `ProjectDetail.vue` | flikvyerna |
| `app/components/modals/*.vue` | formulärmodaler |
| `app/utils/{dates,colors,format,analytics,constants}.ts` | rena hjälpfunktioner (portade) |

## Felsökning

**`ERR_UNSUPPORTED_DIR_IMPORT` / "Directory import '.' is not supported … vite-node"** i dev:
vite-nodes modulcache har hamnat i ett trasigt läge (händer om filer/deps ändras medan
dev-servern kör). Fix:

```bash
# döda ev. kvarvarande dev-server först
pkill -f "nuxt dev"
rm -rf .nuxt .output node_modules/.cache
npm install
npm run dev
```

Dev-servern kör på **port 3001**.

## Deploy (Netlify)

Repo-rotens `netlify.toml` pekar `base` på denna mapp. Nitro genererar serverfunktion +
statiska filer. Sätt `DATABASE_URL` och `JWT_SECRET` som env-vars i Netlify-sitens inställningar.
