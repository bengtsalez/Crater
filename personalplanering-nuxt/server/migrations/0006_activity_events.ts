// 0006_activity_events
//
// Generell aktivitetslogg: automatiskt inspelade affärshändelser (inte en
// dev-audit-logg) så att en projektledare kan öppna ett projekt eller en kund
// och på ~20 sekunder förstå vad som hänt. event_type + metadata är source of
// truth – inga färdigformulerade svenska textkolumner; frontend formaterar.
//
// entity_type/entity_id är polymorfa (kan peka på projects, customers, tasks,
// assignments eller project_line_items) och saknar därför FK. project_id och
// customer_id är separata, oberoende nullable kolumner:
//  - project_id (CASCADE) sätts för alla projekt-scopade händelser (project.*,
//    small_job.*, task.*, line_item.*, assignment.*) – tas bort automatiskt
//    om projektet raderas, konsekvent med att project_line_items/assignments
//    redan cascadar på projektradering.
//  - customer_id (SET NULL) sätts BARA för kund-entitetshändelser
//    (customer.created/updated). Projekt-scopade händelser lämnar den NULL;
//    kundens aktivitetsflöde hämtas i stället via en JOIN mot projects.customer_id
//    vid läsning – annars skulle man behöva fatta ett beslut om "historisk" kund
//    varje gång ett projekt byter kund, vilket inte är värt komplexiteten här.
//    SET NULL (inte CASCADE) skyddar mot att en kundradering (som redan bara
//    tillåts när kunden har noll kopplade projekt) rensar bort andra projekts
//    historik.

export default /* sql */ `
CREATE TABLE IF NOT EXISTS activity_events (
  id           BIGSERIAL PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entity_type  TEXT NOT NULL,
  entity_id    BIGINT NOT NULL,
  project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  customer_id  BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  event_type   TEXT NOT NULL,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_events_org_project_created_idx ON activity_events (org_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_org_customer_created_idx ON activity_events (org_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_org_created_idx ON activity_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_entity_idx ON activity_events (entity_type, entity_id);
`
