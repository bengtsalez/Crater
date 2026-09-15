// 0003_small_jobs
//
// Ströjobb: lättviktiga arbeten (garanti, service, mindre kompletteringar) som
// tekniskt är vanliga `projects`-rader, urskilda av `work_type`/`billing_type`.
// Ingen ny tabell – samma assignments/tidslinje-logik återanvänds rakt av.
//
// `source_project_id` länkar ett ströjobb tillbaka till ett tidigare "riktigt"
// projekt (t.ex. ett garantiärende efter en dränering).

export default /* sql */ `
ALTER TABLE projects ADD COLUMN work_type TEXT NOT NULL DEFAULT 'project';
ALTER TABLE projects ADD COLUMN billing_type TEXT NOT NULL DEFAULT 'billable';
ALTER TABLE projects ADD COLUMN source_project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE projects ADD CONSTRAINT projects_work_type_check CHECK (work_type IN ('project', 'small_job'));
ALTER TABLE projects ADD CONSTRAINT projects_billing_type_check CHECK (billing_type IN ('billable', 'warranty', 'internal'));

CREATE INDEX projects_source_project_idx ON projects (source_project_id);
`
