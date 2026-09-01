import { pool } from './db'

/**
 * Synka ett projekts start-/slutdatum mot dess bokningar.
 *
 * Projektet får `start_date = MIN(bokningarnas start)` och
 * `end_date = MAX(bokningarnas slut)`. Skrivningen sker bara när värdet
 * faktiskt skiljer sig – så när man bokar in ytterligare personal vars
 * datum redan ryms i spannet blir det ingen onödig uppdatering.
 *
 * Anropas från bokningsmutationer när användaren kryssat i
 * "uppdatera projektets datum". Om projektet saknar bokningar lämnas
 * datumen orörda.
 */
export async function syncProjectDatesToAssignments(
  orgId: number,
  projectId: number | string
): Promise<void> {
  await pool.query(
    `
    UPDATE projects p
    SET start_date = d.min_start, end_date = d.max_end
    FROM (
      SELECT MIN(a.start_date) AS min_start, MAX(a.end_date) AS max_end
      FROM assignments a
      WHERE a.org_id = $1 AND a.project_id = $2
    ) d
    WHERE p.id = $2
      AND p.org_id = $1
      AND d.min_start IS NOT NULL
      AND (p.start_date IS DISTINCT FROM d.min_start OR p.end_date IS DISTINCT FROM d.max_end)
    `,
    [orgId, projectId]
  )
}
