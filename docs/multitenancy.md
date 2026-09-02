# Flerkund-arkitektur (multi-tenancy)

Gäller `personalplanering-nuxt/`. Den gamla `personalplanering/` (Express) delade samma
databas men togs bort 2026-09-02 (se "Arv från den borttagna Express-appen" nedan).

## Modell

- **`organizations`** – en rad per kund. `slug` unik, `app_title` visas i appens rubrik,
  `onboarded_at` (NULL = onboarding pågår), `onboarding_state` (JSONB, wizardens markör).
- **`departments`** – per-org avdelningar (`mark`/`fasad`/`te` som default). `UNIQUE(org_id, key)`.
- Varje delad tabell (`resources`, `projects`, `assignments`, `project_line_items`, `tasks`,
  `users`, `settings`) har `org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`.
- `users.username` är **globalt unik** (login tar användarnamn utan org-väljare).
  `users.email` är unik (nullable), `users.role` ∈ `admin` | `member`.
- `projects.project_number` är unikt **per org** (`projects_org_number_uniq`), golv `P1115`.

## Scoping-kontrakt

- Varje `server/api/**`-handler börjar med `requireOrg(event)` (eller `requireUser` +
  `user.org`). Alla `SELECT`/`UPDATE`/`DELETE` filtrerar på `org_id`; alla `INSERT` sätter det.
- PUT/DELETE mot ett id i en annan org → 404 (samma som "finns inte").
- Rader som refererar en annan entitet (assignment → resource/project, line-item → project,
  task → project, project → PM-user) verifierar att målet ligger i samma org.
- Join-fragmenten i `server/utils/queries.ts` har `AND x.org_id = y.org_id` som extra skydd.
- `category`-kolumnerna lagrar avdelningens `key` som TEXT, scopad via radens `org_id`.
  `key` är **oföränderlig** – UI redigerar bara `label`. Att ta bort en avdelning som
  används av personal/projekt ger 409.

## Arv från den borttagna Express-appen

Den gamla `personalplanering/` (Express + vanilla-JS) togs bort 2026-09-02. Spår som finns
kvar i den delade databasen:

- `org_id`-kolumnerna har fortfarande `DEFAULT` = Byggproffs (org 1) från
  `0001_multitenancy`. Kan tas bort med en framtida migration nu när ingen skrivare
  förlitar sig på defaulten, men är ofarligt att låta stå.
- De tre ursprungsavdelningarna (`mark`/`fasad`/`te`) för org 1 skapades av den gamla appen.
  Nu redigerbara som vilken avdelning som helst – inget hårdkodat beroende kvar.

## Self-service signup

`POST /api/signup` (publik) skapar org + admin + tre default-avdelningar i en transaktion,
sätter sessionskakan och returnerar `{ ok, onboarding: true }`. Skydd: honeypot-fält +
in-memory rate limit (5/h per IP) + teckenregler. Klienten skickar sedan användaren till
`/onboarding`; `app/middleware/auth.global.ts` tvingar icke-onboardade orgar dit och
onboardade därifrån.
