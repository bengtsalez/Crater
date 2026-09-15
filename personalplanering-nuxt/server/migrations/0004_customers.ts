// 0004_customers
//
// Riktig kundentitet: en org-scopad `customers`-tabell med en genererad,
// normaliserad `name_key` (trim, kollapsad whitespace, gemener) som bär
// unikheten per org — samma "hitta eller skapa" garanti mot kapplöpningar
// som t.ex. projects_org_number_uniq ger för projektnummer.
//
// `projects.customer_id` pekar mot kunden. `projects.client` behålls som en
// server-skriven spegel av kundens namn (se server/utils/customers.ts) eftersom
// den gamla Express-appen läser client direkt ur samma databas.
//
// Backfill: en kund per distinkt normaliserat client-värde PER ORG. Ingen
// fuzzy-matchning — "Brinova" och "Brinova Fastigheter AB" blir två kunder.
// DISTINCT ON + ORDER BY p.id => det äldsta projektets stavning blir kanonisk.

export default /* sql */ `
CREATE TABLE IF NOT EXISTS customers (
  id                   BIGSERIAL PRIMARY KEY,
  org_id               BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  name_key             TEXT GENERATED ALWAYS AS (lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))) STORED,
  customer_type        TEXT,
  organization_number  TEXT,
  contact_person       TEXT,
  email                TEXT,
  phone                TEXT,
  mobile               TEXT,
  address              TEXT,
  postal_code          TEXT,
  city                 TEXT,
  billing_address      TEXT,
  billing_postal_code  TEXT,
  billing_city         TEXT,
  billing_email        TEXT,
  invoice_reference    TEXT,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_org_name_key_uniq ON customers (org_id, name_key);
CREATE INDEX IF NOT EXISTS customers_org_idx ON customers (org_id);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS projects_customer_idx ON projects (customer_id);

INSERT INTO customers (org_id, name)
SELECT DISTINCT ON (p.org_id, lower(regexp_replace(btrim(p.client), '[[:space:]]+', ' ', 'g')))
       p.org_id, btrim(p.client)
FROM projects p
WHERE p.client IS NOT NULL AND btrim(p.client) <> ''
ORDER BY p.org_id, lower(regexp_replace(btrim(p.client), '[[:space:]]+', ' ', 'g')), p.id
ON CONFLICT (org_id, name_key) DO NOTHING;

UPDATE projects p SET customer_id = c.id
FROM customers c
WHERE p.customer_id IS NULL AND p.client IS NOT NULL AND btrim(p.client) <> ''
  AND c.org_id = p.org_id
  AND c.name_key = lower(regexp_replace(btrim(p.client), '[[:space:]]+', ' ', 'g'));
`
