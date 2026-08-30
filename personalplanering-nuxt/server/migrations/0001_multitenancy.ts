// 0001_multitenancy
//
// Inför flerkund-stöd: organizations + departments, org_id på varje delad
// tabell, och backfill av all befintlig data till default-orgen "Byggproffs".
// Gamla Express-appen (personalplanering/) fortsätter fungera oförändrad: den
// nämner aldrig org_id i sina INSERTs och får då DEFAULT = Byggproffs id.
//
// SQL:en lever som en TS-sträng (inte en .sql-fil) så att den garanterat följer
// med i Nitro-serverbunten i produktion.

export default /* sql */ `
-- 1. tenant-tabeller
CREATE TABLE IF NOT EXISTS organizations (
  id               BIGSERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  app_title        TEXT,
  onboarded_at     TIMESTAMPTZ,
  onboarding_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);
CREATE INDEX IF NOT EXISTS departments_org_sort_idx ON departments (org_id, sort_order);

-- 2. default-org för befintlig data
INSERT INTO organizations (name, slug, app_title, onboarded_at)
VALUES ('Byggproffs', 'byggproffs', 'Byggproffs Personalplanering', now())
ON CONFLICT (slug) DO NOTHING;

-- 3. användaridentitet + roll
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role  TEXT NOT NULL DEFAULT 'admin';
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uniq ON users (lower(email)) WHERE email IS NOT NULL;

-- 4. org_id-kolumner (nullable först)
ALTER TABLE resources          ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE projects           ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE assignments        ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE project_line_items ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE tasks              ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE users              ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE settings           ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;

-- 5. backfill + default-avdelningar + DEFAULT-pinning
DO $$
DECLARE org BIGINT;
BEGIN
  SELECT id INTO org FROM organizations WHERE slug = 'byggproffs';

  UPDATE resources          SET org_id = org WHERE org_id IS NULL;
  UPDATE projects           SET org_id = org WHERE org_id IS NULL;
  UPDATE assignments        SET org_id = org WHERE org_id IS NULL;
  UPDATE project_line_items SET org_id = org WHERE org_id IS NULL;
  UPDATE tasks              SET org_id = org WHERE org_id IS NULL;
  UPDATE users              SET org_id = org WHERE org_id IS NULL;
  UPDATE settings           SET org_id = org WHERE org_id IS NULL;

  INSERT INTO departments (org_id, key, label, sort_order) VALUES
    (org, 'mark',  'Mark',  0),
    (org, 'fasad', 'Fasad', 1),
    (org, 'te',    'TE',    2)
  ON CONFLICT (org_id, key) DO NOTHING;

  -- Gamla appen skriver rader utan org_id → dessa DEFAULTs pinnar den till Byggproffs.
  EXECUTE format('ALTER TABLE resources          ALTER COLUMN org_id SET DEFAULT %L', org);
  EXECUTE format('ALTER TABLE projects           ALTER COLUMN org_id SET DEFAULT %L', org);
  EXECUTE format('ALTER TABLE assignments        ALTER COLUMN org_id SET DEFAULT %L', org);
  EXECUTE format('ALTER TABLE project_line_items ALTER COLUMN org_id SET DEFAULT %L', org);
  EXECUTE format('ALTER TABLE tasks              ALTER COLUMN org_id SET DEFAULT %L', org);
  EXECUTE format('ALTER TABLE users              ALTER COLUMN org_id SET DEFAULT %L', org);
END $$;

-- 6. lås ned org_id
ALTER TABLE resources          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE projects           ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE assignments        ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE project_line_items ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE tasks              ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE users              ALTER COLUMN org_id SET NOT NULL;

-- 7. settings: composite PK
ALTER TABLE settings ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
ALTER TABLE settings ADD PRIMARY KEY (org_id, key);

-- 8. index på varje org_id-FK
CREATE INDEX IF NOT EXISTS resources_org_idx          ON resources (org_id);
CREATE INDEX IF NOT EXISTS projects_org_idx           ON projects (org_id);
CREATE INDEX IF NOT EXISTS assignments_org_idx        ON assignments (org_id);
CREATE INDEX IF NOT EXISTS project_line_items_org_idx ON project_line_items (org_id);
CREATE INDEX IF NOT EXISTS tasks_org_idx              ON tasks (org_id);
CREATE INDEX IF NOT EXISTS users_org_idx              ON users (org_id);

-- 9. projektnummer unikt per org
CREATE UNIQUE INDEX IF NOT EXISTS projects_org_number_uniq ON projects (org_id, project_number);
`
