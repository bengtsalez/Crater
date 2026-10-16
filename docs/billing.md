# Fakturering – faktureringsunderlag per projekt

Fliken **Fakturering** i projektvyn tar fram faktureringsunderlag (PDF) som används för att skapa fakturor i Fortnox. Underlaget är inte en faktura. Någon Fortnox-integration finns inte än, men allt sparas strukturerat (öre, baspunkter, snapshots) så att en senare koppling kan använda samma data.

## Flöde i fliken

1. **Fakturaposter**: fyll i raderna. Grundavtalets totalsumma är posternas summa inkl. moms, som sparas av `saveBaseLines`. En ROT-markerad post slår på ROT för projektet.
2. **Delbetalningar**: procent per del, och beloppet visas direkt. Fördelningen per post föreslås automatiskt och kan justeras under "Justera fördelning per post".
3. **Fakturering**: lista över delbetalningar, ÄTA och korrigeringar. ROT, status, betalningar och PDF hanteras i delens modal.

## Behörighet

- `admin` och `member` (projektledare/kontor) kan läsa och hantera faktureringen i **alla** org:ens projekt, oavsett vem som är projektledare.
- `employee` och `accountant` nekas. Middlewarens allow-listor stoppar dem, och varje route anropar dessutom `requireBilling()` (`server/utils/auth.ts`). Det gäller även PDF och klartextpersonnummer.
- Allt scopas på `org_id`. Ett id från en annan org ger 404.
- Företagsuppgifter (`/api/billing/company`) får läsas av admin/member, men bara admin kan ändra dem.
- Små jobb (`work_type = 'small_job'`) har ingen faktureringsflik.

## Datamodell (migration `0008_billing`)

| Tabell | Innehåll |
|---|---|
| `project_billing` | Grundavtalets totalsumma inkl. moms före ROT (`base_total_inc_ore`), ROT på/av och procentsats, fastighetsbeteckning/bostadsuppgifter samt löpnummer för underlag. |
| `billing_lines` | Fakturarader: `part_id IS NULL` = grundunderlaget, annars rader i en ÄTA- eller korrigeringsdel. Antal `NUMERIC(14,3)`, à-pris **exkl. moms** `NUMERIC(20,6)`, moms i baspunkter. |
| `billing_parts` | Faktureringsdelar: `installment` (procent av grundavtalet), `ata` (unik per ÄTA) och `correction` (kopplad till originalet). Delarna har status, underlagsnummer, betalnings- och ROT-uppföljning samt `locked_summary` när de är fakturerade. |
| `billing_allocations` | Hur grundraderna fördelas på delbetalningar (öre exkl. moms per rad och del). |
| `billing_rot_recipients` | Två mottagare per del: namn, personnummer krypterat med AES-256-GCM och manuellt belopp (0 kr som standard). |
| `billing_documents` | Oföränderliga versioner (JSON-snapshot) som skapas när en del markeras fakturerad. En trigger stoppar UPDATE. |

ÄTA (`project_line_items`) har nu också `ata_status` (`utkast`/`skickad`/`godkand`/`avbojd`). Befintliga ÄTA backfylldes som `utkast`, så endast `godkand` kan hämtas. `revision` räknas upp när beskrivning eller belopp ändras. Organisationen har nu också fält för org.nr, momsreg.nr, adress, bankgiro och F-skatt.

## Beräkningar (`shared/billing.ts`)

- Belopp räknas i heltal öre och decimaler med BigInt, utan flyttal. Avrundning sker half-up.
- Priset lagras **alltid exkl. moms**. Växeln Exkl./Inkl. moms ändrar bara visning och inmatning, så upprepad växling ändrar aldrig priset.
- Moms beräknas per momssats på summan.
- **ROT** minskar bara "Att betala". Försäljning och momsunderlag påverkas inte. Max-ROT = ROT-berättigat arbete inkl. moms × procentsats. Det är ett beräkningsstöd: ROT-belopp fylls aldrig i automatiskt.
- Delbetalningarnas mål är procent × grundavtalets totalsumma inkl. moms. Den **sista öppna** delen tar upp avrundningen, och fakturerade delar behåller sitt låsta belopp.
- Fördelningsförslaget är proportionellt per rad. Varje rads rest hamnar i sista öppna delen, så en rad fördelas aldrig dubbelt. Manuella justeringar valideras.
- För att en del ska få bli "Klar för fakturering" eller "Fakturerad" måste allt detta stämma:
  - raderna motsvarar grundavtalet
  - planen är 100 %
  - fördelningen är exakt
  - delen motsvarar sitt mål (±1 kr i avrundning)
  - ROT ≤ max, och den som har ett ROT-belopp har namn och giltigt personnummer
  - en ÄTA-del är specificerad med rader, och eventuella avvikelser mot källposten är bekräftade

## Status och låsning

`planerad → klar → fakturerad → betald`. Det går att backa från `klar` till `planerad` och från `betald` till `fakturerad`.

När en del markeras **fakturerad** sker följande i samma transaktion:
- delen låses (`locked_at`, `locked_summary`)
- en `billing_documents`-version sparas, med kund, projekt, företag, rader och summor, och personnummer i krypterad form
- händelsen loggas

En låst del tillåter bara ändring av anteckning, Fortnox-nummer och betalningsuppföljning. Allt annat kräver en **korrigering** (ny del med `corrects_part_id` och eget underlagsnummer; negativa rader är tillåtna). PDF för en låst del byggs alltid av den sparade versionen.

Kundbetalning och ROT (ej sökt/sökt/utbetalt/avslag, sökt och utbetalt belopp) följs separat och ändrar aldrig underlaget.

## ÄTA

"Hämta ÄTA" listar projektets ÄTA. Bara godkända och ännu inte hämtade poster kan väljas, och varje vald ÄTA blir en egen del.

Dubbel hämtning stoppas på tre sätt:
- projektlåset (`SELECT … FOR UPDATE` på `project_billing`)
- radlås på ÄTA-posterna
- ett unikt index på `billing_parts.ata_line_item_id`

En hämtad ÄTA kan inte avgodkännas eller tas bort.

Eftersom dagens ÄTA bara har ett totalbelopp måste raderna specificeras i delen. Arbetsandel och ROT gissas inte. Om källposten ändras efter hämtningen visas en avvikelse på en öppen del, som måste bekräftas. Fakturerade delar påverkas inte.

## Drift

- **`BILLING_ENCRYPTION_KEY`** (32 byte, base64: `openssl rand -base64 32`) måste sättas i Netlify, och lokalt i `.env`, innan ROT-personnummer kan sparas. Om nyckeln saknas ger sparning av personnummer ett tydligt 500-fel. Nyckeln läses via `process.env` och aldrig via `runtimeConfig`. Om nyckeln byts går befintliga personnummer inte längre att läsa.
- PDF skapas med `pdf-lib` (ren JS) och standardfonten Helvetica (WinAnsi). Tecken utanför teckenuppsättningen ersätts med `?`.
- Aktivitetsloggen får händelserna `billing.*` och `line_item.ata_status_changed`. Metadata innehåller aldrig personnummer.

## Tester

- `shared/billing.spec.ts` innehåller beräkningar och acceptanstestet: 200 000 kr fördelat 30/40/30 ger 60 000/80 000/60 000 kr, max-ROT blir 9 000/12 000/9 000 kr och att betala 51 000/68 000/51 000 kr. Där finns också momsväxling, avrundning, låsning och personnummer.
- `test/billing.db.spec.ts` kör mot PGlite och täcker:
  - org-separation
  - att bara godkända ÄTA kan hämtas
  - samtidig hämtning
  - låsning och oföränderliga versioner
  - separata betalningar
  - kryptering
  - aktivitetslogg
- `server/utils/billingPdf.spec.ts` täcker 150 rader, flera sidor, upprepade rubriker, svenska tecken, utkastmärkning och att mottagare med 0 kr utelämnas.
- `npm run test:e2e`, avsnitt 10, kör HTTP mot den byggda servern och täcker:
  - att member som inte är projektets projektledare har åtkomst
  - att personal, redovisning och annan org nekas alla 18 fakturerings-anrop inklusive PDF
  - samtidig ÄTA-hämtning
