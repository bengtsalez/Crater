import { pool } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { apiError } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const id = getRouterParam(event, 'id')
  const b = await readBody(event)
  const label = String(b?.label ?? '').trim()
  if (label.length < 1 || label.length > 40) {
    throw apiError(400, 'Ogiltig avdelningsetikett.')
  }

  // Bara etiketten är redigerbar – `key` är oföränderlig (rader refererar den).
  const { rows } = await pool.query(
    `UPDATE departments SET label = $1 WHERE id = $2 AND org_id = $3
     RETURNING id, org_id, key, label, sort_order`,
    [label, id, user.org]
  )
  if (!rows[0]) throw apiError(404, 'Hittades inte.')
  return rows[0]
})
