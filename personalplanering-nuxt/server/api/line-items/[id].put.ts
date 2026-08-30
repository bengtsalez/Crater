import { pool } from '../../utils/db'
import { requireOrg } from '../../utils/auth'
import { apiError } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = getRouterParam(event, 'id')
  const existingResult = await pool.query('SELECT * FROM project_line_items WHERE id = $1 AND org_id = $2', [id, orgId])
  const existing = existingResult.rows[0]
  if (!existing) throw apiError(404, 'Hittades inte.')

  const b = await readBody(event)
  const { rows } = await pool.query(
    `UPDATE project_line_items SET description=$1, amount=$2, date=$3, notes=$4 WHERE id=$5 AND org_id=$6 RETURNING *`,
    [
      b.description ?? existing.description,
      b.amount ?? existing.amount,
      b.date ?? existing.date,
      b.notes ?? existing.notes,
      id,
      orgId,
    ]
  )
  return rows[0]
})
