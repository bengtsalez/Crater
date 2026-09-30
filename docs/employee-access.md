# Personalvy och personalkonton

Anställda loggar in via **`/personal/login`** och ser bara sina egna inplanerade
arbeten, sina egna uppgifter och den information som projektledaren har publicerat.
Samma inloggning (`POST /api/login`, JWT i httpOnly-cookien `session`) används. Rollen i
svaret avgör vart man hamnar, så en anställd som loggar in via `/login` hamnar också på
`/personal`.

## Roller

| Roll       | Vem                       | Ser                                                  |
|------------|---------------------------|------------------------------------------------------|
| `admin`    | org-ägare                 | allt + Konton, org-inställningar                     |
| `member`   | projektledare/kontor      | allt internt (oförändrat)                            |
| `employee` | fältpersonal (ny)         | bara `/personal`: egna bokningar, uppgifter och info |

## Koppling konto ↔ personalresurs

- `users.resource_id → resources.id` är en uttrycklig relation. Ett unikt index gör att
  varje resurs har högst ett konto. Ingen matchning sker på namn eller telefon.
- Admin skapar kontot under fliken **Konton** (samma flöde som tidigare: admin sätter
  lösenordet och delar det med personen). Rollen sätts till *Personal* och en
  personalresurs väljs. Resursen måste finnas i samma org och får inte redan vara kopplad.
- Samma vy används för att byta koppling, återställa lösenord, ange telefon och
  **avaktivera/återaktivera** (`users.active`).
- Ett personalkonto utan koppling (eller vars resurs har tagits bort, `ON DELETE SET NULL`)
  kan logga in, men får beskedet *"Ditt konto är inte kopplat till någon personalresurs"*
  och ingen arbetsdata (`403 code: no_resource`).

## Behörigheter (servern)

1. **`server/middleware/auth.ts`** läser `users` från DB på *varje* `/api/**`-anrop.
   JWT:n används bara som identitet. Roll, org, `active` och `resource_id` tas från DB,
   så avaktivering, rollbyte och ändrad koppling gäller direkt, även om en äldre token
   fortfarande är giltig. Ett avaktiverat konto får `401` och kakan rensas.
2. **Deny-by-default för personal:** `employee` får bara nå `/api/me`, `/api/logout` och
   `/api/employee/**` (`isEmployeeAllowedPath`, som normaliserar `..`, `%2e`, `//` och
   skiftläge). Alla interna API:er (projekt, kunder, ekonomi/ÄTA, användare,
   avdelningar, org, onboarding, bokningar, resurser, uppgifter) ger `403`.
3. Defense-in-depth: `requireOrg`/`requireInternal` i interna routes nekar också `employee`.
4. **`/api/employee/**`** (`server/utils/employeeAccess.ts`) bygger varje fråga från
   serverns `org` + `resource_id`. Ett arbete är åtkomligt bara om personen har en egen
   bokning (`assignments`) på projektet. Samma `404` ges för "finns inte", "annan org" och
   "inte tilldelad". Svaren innehåller bara vitlistade fält:
   - projekt: nummer, namn, arbetsplatsadress
   - egna bokningar
   - projektledarens användarnamn, telefon och e-post
   - kund: namn, kontaktperson, telefon, mobil och adress (aldrig org.nr, e-post,
     fakturauppgifter eller anteckningar)
   - publicerad arbetsinformation
   - egna uppgifter
5. Personal får bara ändra **status** (`aktiv`/`avslutad`) på uppgifter där
   `tasks.user_id` = en själv och projektet har en egen bokning
   (`PUT /api/employee/tasks/:id`). Ändringen loggas som `task.completed`/`task.reopened`
   och syns i projektledarens vy.

| Endpoint | Beskrivning |
|---|---|
| `GET /api/employee/jobs[?from&to]` | egna bokningar (standard: idag och framåt; intervall = överlapp) |
| `GET /api/employee/jobs/:projectId` | detaljvy för ett arbete |
| `PUT /api/employee/tasks/:id` | `{ status }` på egen uppgift |

## Projektledarens flöde

I projektdetaljen finns avsnittet **Information till personal**:

- **Arbetsbeskrivning/instruktioner:** fri text som klistras in (tom rad ger nytt
  stycke, rader som börjar med `-`/`•`/`*` eller `1.` blir listor), med förhandsvisning.
  Texten sparas i `project_staff_info`, helt separat från projektets interna
  `notes`. Den syns för personal först när **Synlig för inplanerad personal** är
  ikryssad. Texten renderas utan `v-html`, så HTML visas som text.
  "Senast uppdaterad av X" visas, och ändringar loggas i aktivitetsflödet
  (`staff_info.updated|published|unpublished`).
- **Uppgifter till personal:** "+ Ny uppgift till personal" öppnar den vanliga
  uppgiftsmodalen med fältet **Tilldela**. `tasks.user_id` = personalkontot,
  `tasks.created_by_user_id` = projektledaren. En personaluppgift måste höra till ett
  projekt. Projektledaren ser status (Klar/Ej klar) och kan redigera och ta bort.
- **Arbetsplatsens adress** anges i projekt- och ströjobbsmodalen
  (`projects.site_address`).
- Tabellen *Inplanerad personal* visar vilka som har ett personalkonto.

## Klient

- `/personal` (Mina arbeten) och `/personal/arbete/:id` använder layouten `employee` och
  `useEmployeeData()`, med egen polling som bara anropar `/api/employee/**`.
  `useAppData().loadAll()` körs aldrig för personal.
- `resetClientState()` (stoppar polling och kör `clearNuxtState()`) körs vid utloggning,
  inloggning, 401 och när ett annat konto upptäcks i den globala route-middlewaren.

## Filbilagor – uppskjutet

Uppladdning av dokument och bilder till personal är **inte byggd**. Appen körs som
Netlify Functions (tillfälligt filsystem, ~6 MB request-gräns), så ett lagringsbeslut
krävs först: Postgres `bytea`, Netlify Blobs eller S3-kompatibel lagring med kortlivade
signerade URL:er. Avsnittet *Information till personal* (`ProjectStaffInfo.vue`) och
`getEmployeeJob()` är förberedda för ett bilageblock med samma åtkomstregel: bokad på
projektet och bilagan uttryckligen markerad som synlig.

## Tester

- `npm run test`: enhetstester och DB-integrationstester mot riktig Postgres i minnet
  (PGlite, `test/employeeAccess.db.spec.ts`). Ingen extern databas behövs.
- `npm run test:e2e`: bygger appen och kör HTTP-scenarier mot den byggda servern med
  PGlite via `pglite-socket` (`scripts/e2e-employee.ts`). Med `--serve` startas bara
  servern mot testdatan för manuell kontroll.
