# Egenkontroller & checklistor

Första versionen av egenkontroller och checklistor i Crater (`personalplanering-nuxt/`). Den omfattar:

- ett mallbibliotek per företag med versioner
- kontroller per projekt och etapp
- ifyllnad i personalens mobilvy med foto
- avvikelser, granskning och godkännande
- revisioner och historik
- PDF per kontroll och ett samlat slutprotokoll

En **checklista** (`checklist`) bekräftar att praktiska uppgifter är utförda. En **egenkontroll** (`self_inspection`) dokumenterar dessutom vad som kontrollerats, mot vilket underlag, med vilken metod och med vilket resultat. Båda använder samma modell.

## Användning

### Mallar
Sökväg: fliken **Egenkontroller → Mallar**. Bara admin kan ändra mallar; projektledare ser publicerade mallar.

- **Ny mall:** ange namn, typ, beskrivning och eventuell avdelning, och bygg avsnitt med kontrollpunkter. Avsnitt och punkter kan läggas till, flyttas upp och ner, dupliceras och tas bort.
- **Kontrollpunktens fält:**
  - rubrik och instruktion
  - kontrollunderlag med valfri länk
  - kontrollmetod
  - svarstyp: kontrollresultat, kryssruta, fritext, tal med enhet eller datum
  - obligatoriskt svar, minsta antal bilder, krav på kommentar
  - kritiskt moment, samt när kontrollen ska utföras
- **Utkast och versioner:** allt sparas som ett utkast. **Publicera** skapar nästa version. En publicerad version kan aldrig ändras; en databastrigger stoppar det. Att redigera en publicerad mall skapar ett nytt utkast.
- **Duplicera, arkivera och återställ:** en arkiverad mall går inte att välja för nya kontroller men påverkar inga befintliga.
- **Lägg till exempelmallar:** lägger till fyra exempel för det egna företaget: dränering, fasad, stensättning samt etablering och avetablering.
  - Importen är idempotent; ett exempel som redan finns läggs aldrig till igen.
  - Inga kontroller läggs till i befintliga projekt.
  - Exemplen innehåller inga tekniska gränsvärden. De är märkta som underlag som projektledaren behöver anpassa till projektets krav och produktanvisningar.

### På projektet
Sökväg: projektdetaljen, fliken **Egenkontroller & checklistor**. Fliken finns även för ströjobb.

- **Lägg till från mall:** välj en eller flera rader. Samma mall kan väljas flera gånger, till exempel en per etapp. För varje rad anges plats eller etapp, huvudansvarig och sista datum. Kontrollen får en egen kopia av mallens senaste publicerade version.
- **Projektanpassning:** **Anpassa punkter** fungerar bara i Utkast, innan något svar eller någon bild finns. Därefter ändras frågor och krav genom **Ny revision**, så att tidigare underlag bevaras.
- **Sammanfattning:** projekthuvudet och fliken visar ett av följande lägen:
  - *Ingen kontroll tillagd*. Detta visas neutralt, aldrig som klart.
  - *Obesvarade punkter*
  - *Väntar på granskning*
  - *Komplettering krävs*
  - *Öppna avvikelser*
  - *Alla kontroller godkända*
- **Slutprotokoll (PDF):** samlar projektets godkända kontroller. Om något återstår heter protokollet *Ofullständigt slutprotokoll*. Det listar då kvarvarande kontroller och avvikelser som inte är verifierade och har vattenstämpeln OFULLSTÄNDIGT.

Fliken **Egenkontroller** har också:
- **Kontroller:** alla aktuella kontroller, med filter på status och ansvarig och fritextsökning.
- **Avvikelser:** samlad avvikelselista med filter på projekt, ansvarig och status.

### Personal (mobil)
Personalen ser sina kontroller under **Mina arbeten**:
- Jobbkortet visar "N kontroller att fylla i".
- Arbetets sida har blocket *Egenkontroller & checklistor*.
- Kontrollen öppnas på `/personal/kontroll/:id`.

Så fungerar ifyllnaden:
- Instruktion och underlag visas vid frågan. Kritiska moment har en röd varning.
- Kontrollresultatet anges med stora knappar: **Godkänd**, **Avvikelse** och **Ej tillämplig**.
  - *Obesvarad* är ett eget läge. Inget förval finns.
  - *Godkänd* betyder att utföraren har bedömt punkten, inte att protokollet är godkänt.
- **Avvikelse** kräver en beskrivning. Avvikelseposten skapas när beskrivningen finns.
- **Ej tillämplig** kräver motivering och ersätter punktens krav på foto och mätvärde.
- Foton tas med **Ta foto** (kameran) eller **Välj bild**.
- **Sparstatus** visas per punkt. "Sparad" visas först när servern har bekräftat. Ifyllnaden finns kvar efter omladdning.
- **Konflikt:** om någon annan har sparat samma punkt under tiden visas ett konfliktmeddelande med **Ladda om**, och inget skrivs över.
- **Lämna in för granskning:** efter inlämning kan svaren inte ändras förrän kontrollen har återlämnats för komplettering.
- Personal kan dokumentera åtgärden för en avvikelse, med text och foto.

## Status och regler

| Status | Etikett | Regel |
|---|---|---|
| `draft` | Utkast | Förberedelse och projektanpassning |
| `in_progress` | Pågår | Sätts automatiskt vid första sparade svaret |
| `submitted` | Väntar på granskning | Alla krav är uppfyllda. Öppna avvikelser är tillåtna. |
| `changes_requested` | Komplettering krävs | Granskaren har angett vad som saknas (kommentar krävs) |
| `approved` | Godkänd | Krav uppfyllda och alla avvikelser verifierade. Innehållet låses. |
| `archived` | Arkiverad | Bevarad och skrivskyddad |

**Övergångar**
- Alla övergångar valideras på servern (`INSPECTION_TRANSITIONS` i `shared/inspections.ts`).
- Kontrollraden låses med `SELECT … FOR UPDATE` under övergången. Dubbelklick och samtidiga anrop ger därför exakt en övergång; det andra anropet får `409`.

**Krav per punkt** (`evaluateItem`)
- Obligatoriska punkter måste besvaras.
- Avvikelse kräver beskrivning.
- Ej tillämplig kräver motivering.
- `comment_required` kräver en kommentar.
- `min_photos` kräver så många *bekräftade* bilder. En begärd men inte bekräftad uppladdning räknas inte.

**Godkännande**
- Görs av projektledare eller admin.
- Registrerar konto, tidpunkt och eventuell kommentar.
- Sparar en fullständig ögonblicksbild (`approved_snapshot`). PDF:en för en godkänd kontroll renderas alltid från ögonblicksbilden.

**Revision**
- Kräver en orsak.
- Skapar en ny rad som länkas med `previous_inspection_id`. Punkter, svar och bekräftade bilder kopieras; bildobjekten delas.
- Den tidigare raden ändras inte och dess PDF kan fortfarande återskapas:
  - En godkänd rad förblir *Godkänd* (ersatt).
  - Övriga rader blir *Arkiverad*.
- Avvikelser som inte är verifierade flyttas med till den nya revisionen.
- En punkt som har en sådan avvikelse kan inte tas bort.

**Avvikelser**
- Statusarna är **Öppen**, **Åtgärdad** och **Verifierad**.
- Upprepade sparningar uppdaterar samma öppna avvikelse. Ett partiellt unikt index förhindrar dubbletter.
- Om svaret ändras till Godkänd stänger det inte avvikelsen.
- Bara projektledare och admin kan verifiera och återöppna. Återöppning kräver motivering, och tidigare åtgärd finns kvar i `inspection_deviation_history`.
- **Skapa uppgift** kopplar avvikelsen till en befintlig uppgift i `tasks`. Det skapar högst en uppgift (unikt `task_id`).

## Roller och åtkomst

- **admin:** allt, inklusive mallar.
- **member** (projektledare/kontor): alla kontroller i företaget. Kan skapa, granska, godkänna, revidera, arkivera och verifiera avvikelser. Kan läsa mallar.
- **employee:** når en kontroll bara om *båda* villkoren gäller:
  - personen är kontrollens huvudansvarige
  - personen har en bokning på projektet (samma regel som personalvyn)

  Annars ger servern `404`, även för bilder, PDF och direkta id-anrop. En tilldelning öppnar aldrig ett annars otillgängligt projekt. Personal kan svara, ladda upp, lämna in och dokumentera åtgärd; aldrig godkänna, begära komplettering eller verifiera. API:t ligger under `/api/employee/inspections/**`.
- **accountant** och övriga roller: ingen åtkomst.

**Organisationsavgränsning och identitet**
- Allt avgränsas på `org_id` från serverns verifierade identitet.
- Ett id från ett annat företag ger `404`.
- Projekt, mall, ansvarig och uppgift kontrolleras mot samma företag.
- **CSRF:** inget nytt skydd har lagts till. Funktionen använder det befintliga: sessionskaka med `sameSite: 'lax'` och JSON-kroppar.

## Bilder och lagring

Bilder lagras i **privat S3-kompatibel objektlagring** (Cloudflare R2, AWS S3, MinIO …) via `server/utils/inspectionStorage.ts`, som bygger på `aws4fetch`. Netlify Functions har bara tillfälligt filsystem, så lokal disk används aldrig.

**Flöde**
1. **Webbläsaren förbereder bilden:**
   - Bilden avkodas med EXIF-orienteringen tillämpad, så porträttbilder blir rätt.
   - Den skalas till högst 2400 px och kodas om som JPEG. Det tar också bort EXIF- och GPS-data.
2. **Webbläsaren begär uppladdning:** `POST …/attachments` med typ och storlek.
   - Servern kontrollerar behörigheten och om punkten eller avvikelsen kan ta emot bilder.
   - Servern kontrollerar typ, storlek och antal, och skapar en rad med status `pending`.
   - Servern genererar objektnyckeln `org/<org>/inspections/<id>/<uuid>`.
   - Svaret är en signerad PUT-URL som gäller i 5 minuter.
3. **Webbläsaren laddar upp direkt till lagringen.** Bilden går inte genom serverless-funktionen.
4. **Bekräftelse:** `POST …/attachments/:id/confirm`.
   - Servern läser objektets faktiska storlek och första bytes, och känner igen JPEG, PNG eller WebP på deras magiska tal.
   - Andra filer ges status `rejected` och objektet raderas.
   - Först efter bekräftelsen räknas bilden mot fotokravet.
5. **Visning:** `GET …/attachments/:id` kontrollerar behörigheten och svarar med `302` till en signerad GET-URL som gäller i 60 sekunder. Lagringsnycklar exponeras aldrig.

**Gränser**
- JPEG, PNG och WebP, högst 10 MB per bild och högst 20 bilder per punkt eller avvikelse.
- HEIC som webbläsaren inte kan avkoda ger ett tydligt felmeddelande.

**Borttagning**
- Bilder i inlämnade, godkända eller arkiverade kontroller kan inte tas bort.
- Ett objekt raderas bara om ingen annan rad använder det, till exempel en låst tidigare revision.

**PDF och bilder**
- PDF:en hämtar bara bilder från egen lagring, aldrig från mallarnas länkar.
- Länkar skrivs ut som text.
- WebP kan inte bäddas in i PDF med pdf-lib och visas som en platshållare. Webbläsaren laddar normalt alltid upp JPEG.

### Konfiguration (Netlify → Environment variables)

Variablerna läses från `process.env` vid körning, inte via `runtimeConfig`. Annars stoppar Netlifys secrets-scan bygget.

| Variabel | Värde |
|---|---|
| `INSPECTION_S3_ENDPOINT` | t.ex. `https://<kontoid>.r2.cloudflarestorage.com` eller `https://s3.eu-north-1.amazonaws.com` |
| `INSPECTION_S3_BUCKET` | namnet på en **privat** bucket (ingen publik åtkomst) |
| `INSPECTION_S3_ACCESS_KEY_ID` | åtkomstnyckel med läs- och skrivrätt till bucketen |
| `INSPECTION_S3_SECRET_ACCESS_KEY` | hemlig nyckel |
| `INSPECTION_S3_REGION` | valfri. Standard är `auto` (R2); för AWS anges t.ex. `eu-north-1`. |
| `INSPECTION_S3_FORCE_PATH_STYLE` | valfri. `false` ger virtual-hosted-style; standard är path-style. |

Bucketen behöver en **CORS-regel** som tillåter `PUT` och `GET` från appens origin, med headern `Content-Type`. Exempel för R2/S3:

```json
[{ "AllowedOrigins": ["https://<appens-domän>"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 3600 }]
```

**Saknas konfigurationen**
- Kontrollvyn visar "Bildlagring är inte konfigurerad".
- Fotoknapparna är dolda och uppladdnings-API:t svarar `503 storage_not_configured`.
- Punkter med fotokrav kan inte bli klara, så ingen kontroll kan felaktigt markeras som uppfylld.

## PDF

Implementeras i `server/utils/inspectionPdf.ts` med pdf-lib och delade hjälpare i `pdfCommon.ts`.

- **Format:** A4, Helvetica (WinAnsi, med å/ä/ö/é) och "Sida i av n".
- **Innehåll:** företagsnamn, projektnummer, kund, arbetsplats, kontroll, plats, mallversion, kontrollrevision, svar, mätvärden, kommentarer, bilder, avvikelser, utförare, godkännande och granskningshistorik.
- **Sidlayout:** varje punkt mäts innan den ritas och flyttas hel till nästa sida. Bilder skalas in i sin ruta och roteras enligt EXIF.
- **Ej godkänd:** en kontroll som inte är godkänd får statusruta och vattenstämpel "EJ GODKÄND – <status>".
- **Logotyp:** Crater har i dag ingen företagslogotyp i schemat, så ingen logotyp ritas.

## Datamodell

Migration: `server/migrations/0009_inspections.ts`. Den är additiv.

| Tabell | Innehåll |
|---|---|
| `inspection_templates` | mall, utkast (`draft_content` + `draft_rev`), senaste version, `example_key` |
| `inspection_template_versions` | oföränderliga publicerade versioner (trigger stoppar UPDATE) |
| `inspections` | kontroll på projekt: mallversion, plats, ansvarig, status, revisionskedja, `lock_version`, `approved_snapshot` |
| `inspection_items` | kontrollens egen kopia av punkterna |
| `inspection_answers` | aktuellt svar per punkt, med `rev` för optimistisk låsning |
| `inspection_answer_history` | append-only ändringshistorik för svar |
| `inspection_deviations` och `inspection_deviation_history` | avvikelser och deras historik |
| `inspection_attachments` | bildmetadata och lagringsnyckel (`pending`/`confirmed`/`rejected`/`removed`) |
| `inspection_events` | gransknings- och revisionshistorik |

**Främmande nycklar och skydd**
- Användare som tas bort ger `SET NULL`; namnen sparas i egna kolumner.
- Mallversioner och tidigare revisioner har FK utan `ON DELETE`-regel, så de kan inte raderas så länge en kontroll pekar på dem.
- Att radera ett projekt kaskaderar.
- Triggern `inspection_content_guard` nekar ändring av svar och punkter i inlämnade, godkända och arkiverade kontroller, som försvar på djupet.

**Aktivitetsflöde och historik**
- Aktivitetsflödet loggar `inspection.created`, `.updated`, `.customized`, `.submitted`, `.changes_requested`, `.approved`, `.revised` och `.archived`.
- Det loggar också `deviation.reported`, `.resolved`, `.verified` och `.reopened`.
- Loggningen sker i samma transaktion som ändringen.

## Kod

| Del | Fil |
|---|---|
| Delad logik (statusar, krav, validering, sammanfattning) | `shared/inspections.ts`, `shared/inspectionTypes.ts`, `shared/inspectionExamples.ts` |
| Åtkomst, vyer och ögonblicksbild | `server/utils/inspectionCore.ts` |
| Mallar | `server/utils/inspectionTemplates.ts` |
| Utförande (skapa, anpassa, svar, revision) | `server/utils/inspectionRun.ts` |
| Granskning | `server/utils/inspectionReview.ts` |
| Avvikelser | `server/utils/inspectionDeviations.ts` |
| Bilder | `server/utils/inspectionAttachments.ts`, `inspectionImages.ts`, `inspectionStorage.ts` |
| Export | `server/utils/inspectionExport.ts`, `inspectionPdf.ts` |
| Route-lager | `server/utils/inspectionHttp.ts`, `server/api/{inspections,inspection-templates,inspection-deviations,employee/inspections}/**`, `server/api/projects/[id]/inspections/**` |
| Gränssnitt | `app/components/inspections/*`, `app/composables/useInspection.ts`, `app/utils/inspectionImage.ts`, `app/pages/personal/kontroll/[id].vue` |

Domänfilerna är Nitro-fria och testas direkt mot PGlite.

## Tester

- `test/inspections.db.spec.ts` täcker acceptanskriterierna:
  - mallversioner
  - etapper
  - inlämningskrav
  - avvikelser som blockerar godkännande
  - låsning
  - personalåtkomst
  - företagsgränser, inklusive bilder och export
  - samtidiga sparningar och dubbelinlämning
  - intakta revisionsunderlag
- `shared/inspections.spec.ts` täcker kravregler och mallvalidering.
- `server/utils/inspectionPdf.spec.ts` täcker:
  - A4, flera sidor, svenska tecken och statusmärkning
  - att en porträttbild ritas stående inom marginalerna
  - bildidentifiering
- `scripts/e2e-employee.ts`, avsnitt 11, kör hela flödet över HTTP mot den byggda servern.
  - En **fejkad S3-server** i skriptet kontrollerar att anropen är presignerade och att `Content-Type` ingår i signaturen.
  - Riktig R2/S3, alltså signaturvalidering, CORS och bucketpolicy, testas inte automatiskt.

## Utanför första versionen

Följande ingår inte:
- automatisk delning med kund, kundportal och extern signering (BankID)
- återkommande kontroller
- offlineläge
- automatisk blockering av projektets planering eller status
- flera ansvariga per kontroll
