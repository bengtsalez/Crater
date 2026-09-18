import type { Pool } from 'pg'

type Queryable = { query: Pool['query'] }

export interface LogActivityInput {
  orgId: number
  userId: number | null // null = systemhändelse
  entityType: string
  entityId: number
  projectId?: number | null
  customerId?: number | null
  eventType: string
  metadata?: Record<string, unknown>
}

/**
 * Skriver en aktivitetshändelse. `client` kan vara `pool` eller en pågående
 * transaktions `conn` (samma Queryable-mönster som resolveCustomer).
 *
 * `bestEffort: true` fångar och loggar felet i stället för att kasta – används
 * när anropet sker UTANFÖR en befintlig transaktion: loggningen är sekundär
 * observability, inte kärndata, och ska aldrig kunna få en i övrigt lyckad
 * mutation att se ut som ett fel för användaren.
 * Inom en befintlig transaktion (`conn`) ska felet TVÄRTOM propagera, så att
 * mutation + logg commit/rollback atomiskt – anropa då utan flaggan.
 */
export async function logActivity(
  client: Queryable,
  input: LogActivityInput,
  opts: { bestEffort?: boolean } = {}
): Promise<void> {
  const run = () =>
    client.query(
      `INSERT INTO activity_events (org_id, user_id, entity_type, entity_id, project_id, customer_id, event_type, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.orgId,
        input.userId,
        input.entityType,
        input.entityId,
        input.projectId ?? null,
        input.customerId ?? null,
        input.eventType,
        JSON.stringify(input.metadata ?? {}),
      ]
    )
  if (opts.bestEffort) {
    try {
      await run()
    } catch (err) {
      console.error('[activity] kunde inte logga händelse', input.eventType, err)
    }
  } else {
    await run()
  }
}
