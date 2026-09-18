import { pool } from './db'
import { logActivity } from './activity'

/**
 * Automatisk projektstatus.
 *
 *  - `aktiv`              : projektet har inga bokningar i tidslinjen (nyss skapat).
 *  - `planerad`           : projektet har minst en bokning vars slutdatum är idag eller senare.
 *  - `klar_att_fakturera` : projektet har bokningar men den sista har passerat dagens datum.
 *  - `avslutad`           : nås normalt bara manuellt via `status_override` (t.ex. när
 *                           fakturan är skickad) – MED ETT UNDANTAG, se nedan.
 *
 * Automatiken sätter alltså aldrig `avslutad` själv för vanliga projekt – ett
 * projekt vars planering har passerat blir `klar_att_fakturera` och ligger kvar
 * där tills någon markerar det avslutat.
 *
 * Undantag: ströjobb (`work_type = 'small_job'`) med `billing_type` `warranty`
 * eller `internal` ska aldrig hamna i "Klar att fakturera" – de faktureras inte.
 * För dem hoppar automatiken direkt till `avslutad` när sista bokningen passerat.
 * Vanliga projekt har alltid `billing_type = 'billable'` (kolumnens default), så
 * den här grenen är ett no-op för all befintlig projektdata.
 *
 * En användare kan tvinga en avvikande status via `projects.status_override`.
 * Overriden ligger kvar tills projektets bokningar ändras (create/update/delete),
 * då den nollställs och automatiken tar över igen. `projects.status` speglar alltid
 * `COALESCE(status_override, <auto>)` så att gamla Express-appen och alla
 * läsvägar ser rätt värde utan att känna till automatiken.
 */

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

// Delad subquery: auto-status per projekt (bokningarnas senaste slutdatum + billing_type).
const AUTO_STATUS_SUBQUERY = `
  SELECT
    p2.id,
    p2.work_type,
    CASE
      WHEN MAX(a.end_date) IS NULL THEN 'aktiv'
      WHEN MAX(a.end_date) < $2 THEN
        CASE WHEN p2.billing_type IN ('warranty', 'internal') THEN 'avslutad' ELSE 'klar_att_fakturera' END
      ELSE 'planerad'
    END AS auto_status
  FROM projects p2
  LEFT JOIN assignments a ON a.project_id = p2.id AND a.org_id = p2.org_id
  WHERE p2.org_id = $1
  GROUP BY p2.id
`

// Räkna om `status` för alla projekt i en org. Idempotent; skriver bara rader
// där det faktiska värdet skiljer sig. Körs vid varje GET /api/projects och
// efter varje bokningsmutation.
//
// Loggar en systemhändelse (user_id null) för varje projekt vars status
// faktiskt flippar automatiskt – en SELECT som speglar UPDATE:ns WHERE-villkor
// fångar gammalt/nytt värde FÖRE skrivningen (RETURNING ger bara post-update-
// värden, så det räcker inte ensamt). Litet accepterat SELECT-then-UPDATE-race;
// konsekvent med funktionens redan best-effort/idempotenta stil.
export async function refreshProjectStatuses(orgId: number): Promise<void> {
  const today = todayISO()

  const changing = await pool.query(
    `
    SELECT p.id, p.status AS old_status, d.work_type, COALESCE(p.status_override, d.auto_status) AS new_status
    FROM projects p
    JOIN (${AUTO_STATUS_SUBQUERY}) d ON d.id = p.id
    WHERE p.org_id = $1
      AND p.status IS DISTINCT FROM COALESCE(p.status_override, d.auto_status)
    `,
    [orgId, today]
  )

  await pool.query(
    `
    UPDATE projects p
    SET status = COALESCE(p.status_override, d.auto_status)
    FROM (${AUTO_STATUS_SUBQUERY}) d
    WHERE p.id = d.id
      AND p.org_id = $1
      AND p.status IS DISTINCT FROM COALESCE(p.status_override, d.auto_status)
    `,
    [orgId, today]
  )

  for (const row of changing.rows) {
    const eventType =
      row.work_type === 'small_job' && row.new_status === 'avslutad' ? 'small_job.completed' : 'project.status_changed'
    await logActivity(
      pool,
      {
        orgId,
        userId: null,
        entityType: 'project',
        entityId: row.id,
        projectId: row.id,
        customerId: null,
        eventType,
        metadata: { old_value: row.old_status, new_value: row.new_status },
      },
      { bestEffort: true }
    )
  }
}

// Nollställ den manuella overriden för ett projekt (t.ex. när dess bokningar ändras).
export async function clearStatusOverride(orgId: number, projectId: number | string): Promise<void> {
  await pool.query(
    'UPDATE projects SET status_override = NULL WHERE id = $1 AND org_id = $2',
    [projectId, orgId]
  )
}
