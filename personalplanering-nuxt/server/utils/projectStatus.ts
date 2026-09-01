import { pool } from './db'

/**
 * Automatisk projektstatus.
 *
 *  - `aktiv`     : projektet har inga bokningar i tidslinjen (nyss skapat).
 *  - `planerad`  : projektet har minst en bokning vars slutdatum är idag eller senare.
 *  - `avslutad`  : projektet har bokningar men den sista har passerat dagens datum.
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

// Räkna om `status` för alla projekt i en org. Idempotent; skriver bara rader
// där det faktiska värdet skiljer sig. Körs vid varje GET /api/projects och
// efter varje bokningsmutation.
export async function refreshProjectStatuses(orgId: number): Promise<void> {
  await pool.query(
    `
    UPDATE projects p
    SET status = COALESCE(p.status_override, d.auto_status)
    FROM (
      SELECT
        p2.id,
        CASE
          WHEN MAX(a.end_date) IS NULL     THEN 'aktiv'
          WHEN MAX(a.end_date) < $2        THEN 'avslutad'
          ELSE 'planerad'
        END AS auto_status
      FROM projects p2
      LEFT JOIN assignments a ON a.project_id = p2.id AND a.org_id = p2.org_id
      WHERE p2.org_id = $1
      GROUP BY p2.id
    ) d
    WHERE p.id = d.id
      AND p.org_id = $1
      AND p.status IS DISTINCT FROM COALESCE(p.status_override, d.auto_status)
    `,
    [orgId, todayISO()]
  )
}

// Nollställ den manuella overriden för ett projekt (t.ex. när dess bokningar ändras).
export async function clearStatusOverride(orgId: number, projectId: number | string): Promise<void> {
  await pool.query(
    'UPDATE projects SET status_override = NULL WHERE id = $1 AND org_id = $2',
    [projectId, orgId]
  )
}
