// 0009_inspections
//
// Egenkontroller & checklistor. Se docs/inspections.md.
//
// Modell:
//  - inspection_templates: företagets mall (namn, typ, eventuellt utkast).
//    Publicering skapar en oföränderlig rad i inspection_template_versions
//    (trigger stoppar UPDATE). Mallar raderas aldrig via API:t, de arkiveras.
//  - inspections: en kontroll på ett projekt, skapad från en bestämd
//    mallversion. Punkterna kopieras till inspection_items, så senare
//    malländringar påverkar aldrig en befintlig kontroll. Revisioner är nya
//    rader som pekar på föregående (previous_inspection_id) – den gamla raden
//    och dess svar/bilder ändras inte.
//  - inspection_answers: aktuellt svar per punkt med `rev` för optimistisk
//    låsning; inspection_answer_history är append-only.
//  - inspection_deviations: avvikelser per punkt. Partiellt unikt index
//    stoppar dubbla öppna avvikelser på samma punkt.
//  - inspection_attachments: bilder i privat objektlagring (bara nyckeln här).
//  - inspection_events: gransknings-/revisionshistorik.
//
// Skydd:
//  - Triggers nekar ändring av svar och punkter när kontrollen är inlämnad,
//    godkänd eller arkiverad (försvar på djupet – domänkoden spärrar redan).
//  - Användare: SET NULL + namn sparat i egen kolumn, så historiken överlever.
//  - Mallversioner/tidigare revisioner: FK utan ON DELETE-regel (NO ACTION).
//    Projekt-radering kaskaderar som för fakturering.

export default /* sql */ `
CREATE TABLE IF NOT EXISTS inspection_templates (
  id                  BIGSERIAL PRIMARY KEY,
  org_id              BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('checklist', 'self_inspection')),
  description         TEXT,
  department          TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  draft_content       JSONB,
  draft_rev           INTEGER NOT NULL DEFAULT 1,
  latest_version      INTEGER NOT NULL DEFAULT 0,
  example_key         TEXT,
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inspection_templates_org_idx ON inspection_templates (org_id, status, name);
CREATE UNIQUE INDEX IF NOT EXISTS inspection_templates_example_uniq
  ON inspection_templates (org_id, example_key) WHERE example_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS inspection_template_versions (
  id                    BIGSERIAL PRIMARY KEY,
  org_id                BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id           BIGINT NOT NULL REFERENCES inspection_templates(id),
  version               INTEGER NOT NULL CHECK (version >= 1),
  name                  TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('checklist', 'self_inspection')),
  description           TEXT,
  content               JSONB NOT NULL,
  published_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_by_name     TEXT,
  published_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);
CREATE INDEX IF NOT EXISTS inspection_template_versions_org_idx ON inspection_template_versions (org_id, template_id);

CREATE OR REPLACE FUNCTION inspection_template_versions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Publicerade mallversioner är oföränderliga.';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS inspection_template_versions_no_update ON inspection_template_versions;
CREATE TRIGGER inspection_template_versions_no_update BEFORE UPDATE ON inspection_template_versions
  FOR EACH ROW EXECUTE FUNCTION inspection_template_versions_immutable();

CREATE TABLE IF NOT EXISTS inspections (
  id                      BIGSERIAL PRIMARY KEY,
  org_id                  BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id              INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id             BIGINT REFERENCES inspection_templates(id),
  template_version_id     BIGINT NOT NULL REFERENCES inspection_template_versions(id),
  template_version        INTEGER NOT NULL,
  name                    TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('checklist', 'self_inspection')),
  description             TEXT,
  location                TEXT,
  due_date                TEXT,
  responsible_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  responsible_name        TEXT,
  status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'in_progress', 'submitted', 'changes_requested', 'approved', 'archived')),
  revision                INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  previous_inspection_id  BIGINT REFERENCES inspections(id),
  superseded_by_id        BIGINT REFERENCES inspections(id),
  revision_reason         TEXT,
  lock_version            INTEGER NOT NULL DEFAULT 1,
  started_at              TIMESTAMPTZ,
  submitted_at            TIMESTAMPTZ,
  submitted_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_by_name       TEXT,
  review_comment          TEXT,
  approved_at             TIMESTAMPTZ,
  approved_by_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by_name        TEXT,
  approval_comment        TEXT,
  approved_snapshot       JSONB,
  created_by_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'approved' OR approved_snapshot IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS inspections_project_idx ON inspections (org_id, project_id, created_at);
CREATE INDEX IF NOT EXISTS inspections_responsible_idx ON inspections (org_id, responsible_user_id, status);
CREATE INDEX IF NOT EXISTS inspections_status_idx ON inspections (org_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS inspections_previous_uniq ON inspections (previous_inspection_id) WHERE previous_inspection_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inspection_items (
  id                BIGSERIAL PRIMARY KEY,
  org_id            BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inspection_id     BIGINT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  item_key          TEXT NOT NULL,
  section_title     TEXT NOT NULL DEFAULT '',
  sort_order        INTEGER NOT NULL,
  title             TEXT NOT NULL,
  instruction       TEXT,
  basis             TEXT,
  basis_url         TEXT,
  method            TEXT,
  answer_type       TEXT NOT NULL CHECK (answer_type IN ('result', 'checkbox', 'text', 'number', 'date')),
  unit              TEXT,
  required          BOOLEAN NOT NULL DEFAULT true,
  min_photos        INTEGER NOT NULL DEFAULT 0 CHECK (min_photos BETWEEN 0 AND 20),
  comment_required  BOOLEAN NOT NULL DEFAULT false,
  critical          BOOLEAN NOT NULL DEFAULT false,
  timing_note       TEXT,
  UNIQUE (inspection_id, item_key)
);
CREATE INDEX IF NOT EXISTS inspection_items_insp_idx ON inspection_items (inspection_id, sort_order);

CREATE TABLE IF NOT EXISTS inspection_answers (
  item_id              BIGINT PRIMARY KEY REFERENCES inspection_items(id) ON DELETE CASCADE,
  org_id               BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inspection_id        BIGINT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  result               TEXT CHECK (result IS NULL OR result IN ('ok', 'deviation', 'na')),
  checked              BOOLEAN,
  text_value           TEXT,
  number_value         NUMERIC(18, 4),
  date_value           TEXT,
  comment              TEXT,
  na_reason            TEXT,
  answered_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  answered_by_name     TEXT,
  answered_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  rev                  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS inspection_answers_insp_idx ON inspection_answers (inspection_id);

CREATE TABLE IF NOT EXISTS inspection_answer_history (
  id             BIGSERIAL PRIMARY KEY,
  org_id         BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inspection_id  BIGINT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  item_id        BIGINT NOT NULL REFERENCES inspection_items(id) ON DELETE CASCADE,
  old_value      JSONB,
  new_value      JSONB NOT NULL,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inspection_answer_history_item_idx ON inspection_answer_history (item_id, id);

CREATE TABLE IF NOT EXISTS inspection_deviations (
  id                     BIGSERIAL PRIMARY KEY,
  org_id                 BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id             INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  inspection_id          BIGINT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  item_id                BIGINT NOT NULL REFERENCES inspection_items(id) ON DELETE CASCADE,
  description            TEXT NOT NULL,
  responsible_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  responsible_name       TEXT,
  due_date               TEXT,
  action_description     TEXT,
  status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'verified')),
  reported_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reported_by_name       TEXT,
  resolved_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_by_name       TEXT,
  resolved_at            TIMESTAMPTZ,
  verified_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_by_name       TEXT,
  verified_at            TIMESTAMPTZ,
  reopen_reason          TEXT,
  task_id                INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  rev                    INTEGER NOT NULL DEFAULT 1,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inspection_deviations_open_uniq ON inspection_deviations (item_id) WHERE status <> 'verified';
CREATE UNIQUE INDEX IF NOT EXISTS inspection_deviations_task_uniq ON inspection_deviations (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inspection_deviations_org_idx ON inspection_deviations (org_id, status, project_id);
CREATE INDEX IF NOT EXISTS inspection_deviations_insp_idx ON inspection_deviations (inspection_id);

CREATE TABLE IF NOT EXISTS inspection_deviation_history (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deviation_id  BIGINT NOT NULL REFERENCES inspection_deviations(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  from_status   TEXT,
  to_status     TEXT,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inspection_deviation_history_dev_idx ON inspection_deviation_history (deviation_id, id);

CREATE TABLE IF NOT EXISTS inspection_attachments (
  id                   UUID PRIMARY KEY,
  org_id               BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  inspection_id        BIGINT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  item_id              BIGINT REFERENCES inspection_items(id) ON DELETE CASCADE,
  deviation_id         BIGINT REFERENCES inspection_deviations(id) ON DELETE CASCADE,
  storage_key          TEXT NOT NULL,
  content_type         TEXT NOT NULL,
  byte_size            INTEGER,
  width                INTEGER,
  height               INTEGER,
  exif_orientation     SMALLINT,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'removed')),
  uploaded_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_name     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at         TIMESTAMPTZ,
  removed_at           TIMESTAMPTZ,
  CHECK ((item_id IS NULL) <> (deviation_id IS NULL))
);
CREATE INDEX IF NOT EXISTS inspection_attachments_insp_idx ON inspection_attachments (inspection_id, status);
CREATE INDEX IF NOT EXISTS inspection_attachments_item_idx ON inspection_attachments (item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inspection_attachments_dev_idx ON inspection_attachments (deviation_id) WHERE deviation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inspection_events (
  id             BIGSERIAL PRIMARY KEY,
  org_id         BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inspection_id  BIGINT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  event_type     TEXT NOT NULL,
  from_status    TEXT,
  to_status      TEXT,
  comment        TEXT,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inspection_events_insp_idx ON inspection_events (inspection_id, id);

-- Låsta kontroller: svar och punkter får inte ändras i bakgrunden.
CREATE OR REPLACE FUNCTION inspection_content_guard() RETURNS trigger AS $$
DECLARE
  st TEXT;
BEGIN
  SELECT status INTO st FROM inspections WHERE id = NEW.inspection_id;
  IF st IN ('submitted', 'approved', 'archived') THEN
    RAISE EXCEPTION 'Kontrollen är låst (status %).', st;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS inspection_answers_guard ON inspection_answers;
CREATE TRIGGER inspection_answers_guard BEFORE INSERT OR UPDATE ON inspection_answers
  FOR EACH ROW EXECUTE FUNCTION inspection_content_guard();
DROP TRIGGER IF EXISTS inspection_items_guard ON inspection_items;
CREATE TRIGGER inspection_items_guard BEFORE INSERT OR UPDATE ON inspection_items
  FOR EACH ROW EXECUTE FUNCTION inspection_content_guard();
`
