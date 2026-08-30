import { pool } from '../../utils/db'
import { requireOrg } from '../../utils/auth'
import { apiError } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const b = await readBody(event)
  const { project_id, type, description, amount, date, notes } = b || {}
  if (
    !project_id ||
    !['ata', 'utgift'].includes(type) ||
    !description ||
    !description.trim() ||
    amount === undefined ||
    amount === ''
  ) {
    throw apiError(400, 'Projekt, typ, beskrivning och belopp krävs.')
  }

  const { rowCount } = await pool.query('SELECT 1 FROM projects WHERE id = $1 AND org_id = $2', [project_id, orgId])
  if (!rowCount) throw apiError(400, 'Ogiltig referens.')

  const { rows } = await pool.query(
    `INSERT INTO project_line_items (org_id, project_id, type, description, amount, date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [orgId, project_id, type, description.trim(), Number(amount), date || null, notes || null]
  )
  setResponseStatus(event, 201)
  return rows[0]
})
