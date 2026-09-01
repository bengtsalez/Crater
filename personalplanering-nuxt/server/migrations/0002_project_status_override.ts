// 0002_project_status_override
//
// Automatisk projektstatus (aktiv → planerad → avslutad) härledd ur bokningarna,
// med möjlighet till manuell override. `status` fortsätter vara den kolumn alla
// läser; den nya kolumnen bär bara det påtvingade värdet.
//
// Backfill: allt som redan är manuellt avslutat behålls som override så att
// automatiken inte återöppnar gamla projekt utan bokningar.

export default /* sql */ `
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status_override TEXT;

UPDATE projects
SET status_override = 'avslutad'
WHERE status = 'avslutad' AND status_override IS NULL;
`
