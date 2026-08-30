# Flerkund-arkitektur (multi-tenancy)

Gäller `personalplanering-nuxt/`. Den gamla `personalplanering/` (Express) delar databas
men är permanent låst till en organisation ("Byggproffs", org 1).

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

## Gamla Express-appen

- Opåverkad: dess `INSERT`s nämner aldrig `org_id` och får `DEFAULT` = Byggproffs.
- Dess `db.js`-bootstrap är enbart `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`
  → no-ops mot det migrerade schemat. **Rör den inte.**
- Känd avvikelse: dess `/api/projects/next-number` räknar globalt `MAX(project_number)`,
  inte per org. Ofarligt (unikhet är per org) men kan lämna luckor i Byggproffs-numrering
  när andra orgar finns.
- Byt eller radera **inte** de tre ursprungsavdelningarna (`mark`/`fasad`/`te`) så länge
  gamla appen används – dess statiska frontend skickar de nycklarna hårdkodat.

## Self-service signup

`POST /api/signup` (publik) skapar org + admin + tre default-avdelningar i en transaktion,
sätter sessionskakan och returnerar `{ ok, onboarding: true }`. Skydd: honeypot-fält +
in-memory rate limit (5/h per IP) + teckenregler. Klienten skickar sedan användaren till
`/onboarding`; `app/middleware/auth.global.ts` tvingar icke-onboardade orgar dit och
onboardade därifrån.
