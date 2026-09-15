// 0005_renumber_small_jobs
//
// Ströjobbens nummerserie bytte format (se nextSmallJobNumber i server/utils/db.ts):
// SJ + tvåsiffrigt år + sexsiffrigt löpnummer (SJ26000001) → SJ + löpnummer från
// 1001 (SJ1001). Byt namn på den enda befintliga raden i det gamla formatet så
// att den nya serien har en korrekt, samlad startpunkt utan udda kvarleva.
// Exakt-match i WHERE gör satsen ofarlig att råka köra om.

export default /* sql */ `
UPDATE projects SET project_number = 'SJ1001'
WHERE project_number = 'SJ26000001' AND work_type = 'small_job';
`
