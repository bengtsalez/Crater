import type { Pool } from 'pg'
import { apiError } from './http'

type Queryable = { query: Pool['query'] }

// Validera att en avdelningsnyckel finns i den aktuella orgen. Tom nyckel = ingen
// avdelning vald (tillåtet). Ersätter den tidigare hårdkodade CATEGORIES-listan.
export async function assertDepartmentKey(
  client: Queryable,
  orgId: number,
  key?: string | null
): Promise<void> {
  if (!key) return
  const { rowCount } = await client.query(
    'SELECT 1 FROM departments WHERE org_id = $1 AND key = $2',
    [orgId, key]
  )
  if (!rowCount) {
    throw apiError(400, 'Ogiltig avdelning.')
  }
}

const COMBINING_MARKS = /[̀-ͯ]/g

// Slugifiera en etikett till en stabil nyckel (a–z, 0–9, bindestreck).
export function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
