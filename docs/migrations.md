# Databasmigreringar (personalplanering-nuxt)

Tidigare fanns bara en idempotent bootstrap-sträng i `server/utils/db.ts`. Den finns kvar
(byte-kompatibel med gamla appens `db.js`), men ordnade engångs-migreringar körs nu av en
enkel runner.

## Så funkar det

- Migreringar ligger som TS-moduler i `server/migrations/NNNN_namn.ts` (varje exporterar
  en rå SQL-sträng som `default`), listade i ordning i `server/migrations/index.ts`.
  SQL:en är inbäddad i TS – inte `.sql`-filer – så att den garanterat följer med i
  Nitro-serverbunten i produktion. Mappen ligger utanför `server/utils/` för att inte
  fastna i Nitros auto-import (ett filnamn som börjar med siffra bryter genererade typer).
- `server/utils/migrate.ts` (`runMigrations()`):
  - tar `pg_advisory_lock(72701)` – serialiserar mot samtidiga instanser (serverless).
  - `CREATE TABLE IF NOT EXISTS schema_migrations (version, applied_at)`.
  - varje ofärdig migrering körs i en transaktion; vid fel → `ROLLBACK` + kastar (hela
    `/api/**` ger 500 tills det är löst – samma "blast radius" som den gamla
    bootstrap-strängen).
  - `version` = postens `version`-fält i `index.ts`.
- `server/utils/db.ts`: `ensureSchema()` = memoiserad `pool.query(<bootstrap>).then(() => runMigrations())`.
  `server/middleware/auth.ts` gör `await ensureSchema()` före varje `/api/**`-request. Vid ett
  övergående fel nollställs memon så nästa request försöker igen (i stället för att cacha
  felet för hela funktionsinstansens livstid).

## Köra manuellt

```bash
cd personalplanering-nuxt
npm run migrate      # kör bootstrap + väntande migreringar och avslutar
```

## Lägga till en migrering

1. Skapa `server/migrations/0002_beskrivning.ts` som `export default \`...SQL...\``.
2. Lägg till den sist i `MIGRATIONS`-arrayen i `server/migrations/index.ts`.
3. Skriv framåtriktad DDL/DML. Anta att den kan köras mot en delvis migrerad databas –
   använd `IF NOT EXISTS` / `IF EXISTS` där det går.
4. **Ingen rollback.** Vill man backa gör man en ny framåt-migrering.
5. Testa mot en scratch-databas (eller återställd prod-dump) innan deploy.

## 0001_multitenancy

Skapar `organizations` + `departments`, lägger `org_id` på alla delade tabeller, skapar
default-orgen "Byggproffs", backfillar all befintlig data dit, sätter `org_id`-DEFAULT =
Byggproffs (så gamla appen fortsätter fungera), låser `org_id` till `NOT NULL`, och lägger
index + `projects (org_id, project_number)`-unikhet.

Pre-flight mot prod innan denna körs skarpt:

```sql
SELECT project_number, count(*) FROM projects GROUP BY 1 HAVING count(*) > 1;  -- måste vara tom
SELECT count(*) FROM users WHERE username IS NULL;                             -- 0
```

## 0007_employee_access

Endast additiv. Befintliga rader ändras inte, förutom att `tasks.created_by_user_id`
backfylls med `user_id`.

- `users.active` (default `true`), `users.resource_id` (FK → `resources`, `ON DELETE SET NULL`,
  unik när den är satt), `users.phone`
- `projects.site_address`
- `tasks.created_by_user_id`
- ny tabell `project_staff_info` (arbetsinformation till personal, separat från `projects.notes`)
- index `assignments (org_id, resource_id)`, `tasks (org_id, user_id, project_id)`

Rollen `employee` är ett nytt värde i den befintliga TEXT-kolumnen `users.role` och
kräver ingen DDL. Se `docs/employee-access.md`.
