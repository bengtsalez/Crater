// 0007_employee_access
//
// Personalvy: anställda loggar in med rollen 'employee' och ser bara sina
// egna bokningar/uppgifter. Allt här är additivt – inga befintliga rader
// ändras (utom backfill av tasks.created_by_user_id = user_id).
//
//  - users.resource_id: uttrycklig koppling konto → personalresurs. Unik per
//    resurs (högst ett konto per person). SET NULL om resursen tas bort →
//    kontot tappar då åtkomst till arbetsdata tills det kopplas om.
//  - users.active: avaktivering. Kontrolleras mot DB på varje skyddat anrop
//    (server/middleware/auth.ts), så en äldre giltig JWT slutar fungera direkt.
//  - users.phone: projektledarens kontaktnummer i personalvyn.
//  - projects.site_address: arbetsplatsens adress (skild från kundens).
//  - tasks.created_by_user_id: vem som skapade/tilldelade uppgiften.
//  - project_staff_info: arbetsinformation till personal, medvetet separat
//    från projects.notes (interna anteckningar blir aldrig synliga).

export default /* sql */ `
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_resource_uniq ON users (resource_id) WHERE resource_id IS NOT NULL;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS site_address TEXT;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
UPDATE tasks SET created_by_user_id = user_id WHERE created_by_user_id IS NULL;

CREATE TABLE IF NOT EXISTS project_staff_info (
  project_id          INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  org_id              BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  instructions        TEXT,
  published           BOOLEAN NOT NULL DEFAULT false,
  updated_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_staff_info_org_idx ON project_staff_info (org_id);

CREATE INDEX IF NOT EXISTS assignments_org_resource_idx ON assignments (org_id, resource_id);
CREATE INDEX IF NOT EXISTS tasks_org_user_project_idx ON tasks (org_id, user_id, project_id);
`
