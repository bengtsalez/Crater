# Redovisningsvy (rollen `accountant`)

En redovisningskonsult loggar in via **`/redovisning/login`** och ser org:ens alla
projekt och ströjobb med kund- och faktureringsuppgifter. Vyn är helt skrivskyddad.
Samma inloggning (`POST /api/login`) används, och rollen avgör vart man hamnar.

## Skapa konto

Admin → **Konton** → Nytt konto → Roll *Redovisning*. Ingen resurskoppling behövs.
Avaktivering, rollbyte och lösenordsbyte fungerar som för andra konton och gäller direkt.

## Vad konsulten ser

| Var | Innehåll |
|---|---|
| `/redovisning` | Alla projekt med nummer, namn, kund, org.nr, ort, status, belopp, ÄTA- och utgiftssummor, period och projektledare. Filtrering på status (standard: *Klar att fakturera*) och typ, sökning, summarad och **CSV-export** (semikolon/decimalkomma för svenskt Excel). |
| `/redovisning/projekt/:id` | Projektet, kunden (namn, typ, org.nr, kontaktperson, e-post, telefon, adress), fakturering (fakturaadress, faktura-e-post, referens) samt ÄTA- och utgiftsrader. |

**Visas aldrig:** projektets interna anteckningar (`projects.notes`), kundens interna
anteckningar (`customers.notes`), anteckningar på ÄTA/utgiftsrader, bokningar/personal,
uppgifter, aktivitetsflöde och användare.

## Behörigheter (servern)

- `server/middleware/auth.ts`: deny-by-default. `accountant` når bara `/api/me`,
  `/api/logout` och `/api/accountant/**` (`isAccountantAllowedPath`, samma normalisering
  som för personal). Alla andra API:er ger `403`, inklusive alla skrivande anrop.
- `requireInternal`/`requireOrg` nekar också `accountant` (defense-in-depth).
- `server/utils/accountantAccess.ts` bygger svaren av vitlistade kolumner, scopat på serverns org.
- Ett redovisningskonto kan inte väljas som projektledare.

| Endpoint | Beskrivning |
|---|---|
| `GET /api/accountant/projects` | lista (kör samma statusautomatik som `GET /api/projects`) |
| `GET /api/accountant/projects/:id` | detalj; `404` för annan org / finns inte |

## Tester

- `test/accountantAccess.db.spec.ts` (PGlite), `app/utils/accountant.spec.ts` (filter/CSV),
  `server/utils/employeeAccess.spec.ts` (sökvägs-allowlist).
- `npm run test:e2e`, avsnitt 9: inloggning, org-isolering, att inga interna fält läcker och
  att alla interna/skrivande API:er nekas. Testkonto i `--serve`: `revisor`.
