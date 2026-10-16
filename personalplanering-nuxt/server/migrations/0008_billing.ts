// 0008_billing
//
// Fakturering: faktureringsunderlag per projekt (grundavtal, procentbaserade
// delbetalningar, ÄTA-delar, korrigeringar, manuellt ROT). Ingen Fortnox-
// integration – uppgifterna sparas strukturerat så att en senare koppling kan
// använda samma underlag. Se docs/billing.md.
//
// Konventioner:
//  - Alla belopp i öre (BIGINT). À-pris exkl. moms som NUMERIC(20,6), antal
//    NUMERIC(14,3), momssats/ROT-procent i baspunkter (2500 = 25 %).
//  - ÄTA (project_line_items type='ata') får status. Befintliga rader blir
//    'utkast' (ej godkända) – endast 'godkand' kan hämtas till fakturering.
//    `revision` räknas upp när beskrivning/belopp ändras, så att ett öppet
//    underlag kan visa avvikelse mot sin källpost.
//  - billing_parts.ata_line_item_id är unik för ÄTA-delar → dubbel hämtning
//    stoppas av databasen även vid samtidiga anrop.
//  - billing_documents är oföränderliga versioner (trigger stoppar UPDATE).
//    Personnummer i snapshoten är krypterade (samma format som
//    billing_rot_recipients.personnummer_enc).
//  - FK utan ON DELETE-regel (NO ACTION) kontrolleras vid satsens slut, så
//    projekt-radering (CASCADE) fungerar medan enstaka rader skyddas.

export default /* sql */ `
ALTER TABLE project_line_items ADD COLUMN IF NOT EXISTS ata_status TEXT NOT NULL DEFAULT 'utkast';
ALTER TABLE project_line_items ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE project_line_items ADD COLUMN IF NOT EXISTS approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_line_items ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE project_line_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE project_line_items DROP CONSTRAINT IF EXISTS project_line_items_ata_status_chk;
ALTER TABLE project_line_items ADD CONSTRAINT project_line_items_ata_status_chk
  CHECK (ata_status IN ('utkast', 'skickad', 'godkand', 'avbojd'));

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS organization_number TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS vat_number TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bankgiro TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS f_skatt BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS project_billing (
  project_id            INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  org_id                BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  base_total_inc_ore    BIGINT CHECK (base_total_inc_ore IS NULL OR base_total_inc_ore >= 0),
  rot_enabled           BOOLEAN NOT NULL DEFAULT false,
  rot_rate_bp           INTEGER NOT NULL DEFAULT 3000 CHECK (rot_rate_bp BETWEEN 0 AND 10000),
  property_designation  TEXT,
  housing_type          TEXT CHECK (housing_type IS NULL OR housing_type IN ('villa', 'brf')),
  brf_name              TEXT,
  brf_org_number        TEXT,
  apartment_number      TEXT,
  next_doc_seq          INTEGER NOT NULL DEFAULT 1,
  updated_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_billing_org_idx ON project_billing (org_id);

CREATE TABLE IF NOT EXISTS billing_parts (
  id                    BIGSERIAL PRIMARY KEY,
  org_id                BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL CHECK (kind IN ('installment', 'ata', 'correction')),
  name                  TEXT NOT NULL,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  percent_bp            INTEGER CHECK (percent_bp IS NULL OR percent_bp BETWEEN 0 AND 10000),
  planned_date          TEXT,
  milestone             TEXT,
  notes                 TEXT,
  document_number       TEXT NOT NULL,
  rot_rate_bp           INTEGER NOT NULL DEFAULT 3000 CHECK (rot_rate_bp BETWEEN 0 AND 10000),
  ata_line_item_id      INTEGER REFERENCES project_line_items(id),
  ata_source_revision   INTEGER,
  ata_source            JSONB,
  corrects_part_id      BIGINT REFERENCES billing_parts(id),
  status                TEXT NOT NULL DEFAULT 'planerad'
                          CHECK (status IN ('planerad', 'klar', 'fakturerad', 'betald')),
  invoiced_date         TEXT,
  external_invoice_ref  TEXT,
  customer_paid_ore     BIGINT NOT NULL DEFAULT 0 CHECK (customer_paid_ore >= 0),
  customer_paid_date    TEXT,
  rot_status            TEXT NOT NULL DEFAULT 'ej_sokt'
                          CHECK (rot_status IN ('ej_sokt', 'sokt', 'utbetalt', 'avslag')),
  rot_applied_ore       BIGINT NOT NULL DEFAULT 0 CHECK (rot_applied_ore >= 0),
  rot_paid_ore          BIGINT NOT NULL DEFAULT 0 CHECK (rot_paid_ore >= 0),
  rot_applied_date      TEXT,
  rot_paid_date         TEXT,
  locked_at             TIMESTAMPTZ,
  locked_summary        JSONB,
  created_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind <> 'ata' OR ata_line_item_id IS NOT NULL),
  CHECK (kind <> 'correction' OR corrects_part_id IS NOT NULL),
  CHECK ((status IN ('fakturerad', 'betald')) = (locked_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_parts_ata_uniq ON billing_parts (ata_line_item_id) WHERE kind = 'ata';
CREATE UNIQUE INDEX IF NOT EXISTS billing_parts_docno_uniq ON billing_parts (org_id, document_number);
CREATE INDEX IF NOT EXISTS billing_parts_project_idx ON billing_parts (org_id, project_id, sort_order);

CREATE TABLE IF NOT EXISTS billing_lines (
  id                    BIGSERIAL PRIMARY KEY,
  org_id                BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  part_id               BIGINT REFERENCES billing_parts(id) ON DELETE CASCADE,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  description           TEXT NOT NULL,
  line_type             TEXT NOT NULL CHECK (line_type IN ('arbete', 'material', 'ovrigt')),
  quantity              NUMERIC(14,3) NOT NULL,
  unit                  TEXT,
  unit_price_ex_vat     NUMERIC(20,6) NOT NULL,
  vat_rate_bp           INTEGER NOT NULL DEFAULT 2500 CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  rot_eligible          BOOLEAN NOT NULL DEFAULT false,
  CHECK (NOT rot_eligible OR line_type = 'arbete')
);
CREATE INDEX IF NOT EXISTS billing_lines_project_idx ON billing_lines (org_id, project_id, part_id, sort_order);

CREATE TABLE IF NOT EXISTS billing_allocations (
  part_id               BIGINT NOT NULL REFERENCES billing_parts(id) ON DELETE CASCADE,
  line_id               BIGINT NOT NULL REFERENCES billing_lines(id),
  org_id                BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  amount_ex_ore         BIGINT NOT NULL,
  PRIMARY KEY (part_id, line_id)
);
CREATE INDEX IF NOT EXISTS billing_allocations_line_idx ON billing_allocations (line_id);

CREATE TABLE IF NOT EXISTS billing_rot_recipients (
  id                    BIGSERIAL PRIMARY KEY,
  org_id                BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  part_id               BIGINT NOT NULL REFERENCES billing_parts(id) ON DELETE CASCADE,
  position              SMALLINT NOT NULL CHECK (position IN (1, 2)),
  name                  TEXT,
  personnummer_enc      TEXT,
  personnummer_last4    TEXT,
  amount_ore            BIGINT NOT NULL DEFAULT 0 CHECK (amount_ore >= 0),
  UNIQUE (part_id, position)
);

CREATE TABLE IF NOT EXISTS billing_documents (
  id                    BIGSERIAL PRIMARY KEY,
  org_id                BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  part_id               BIGINT NOT NULL REFERENCES billing_parts(id) ON DELETE CASCADE,
  document_number       TEXT NOT NULL,
  version               INTEGER NOT NULL,
  snapshot              JSONB NOT NULL,
  created_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (part_id, version)
);
CREATE INDEX IF NOT EXISTS billing_documents_part_idx ON billing_documents (org_id, part_id);

CREATE OR REPLACE FUNCTION billing_documents_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'billing_documents är oföränderliga';
END
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS billing_documents_no_update ON billing_documents;
CREATE TRIGGER billing_documents_no_update BEFORE UPDATE ON billing_documents
  FOR EACH ROW EXECUTE FUNCTION billing_documents_immutable();
`
