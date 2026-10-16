import { pool } from '../../utils/db'
import { requireInternal } from '../../utils/auth'
import { apiError } from '../../utils/http'
import { logActivity } from '../../utils/activity'

export default defineEventHandler(async (event) => {
  const user = requireInternal(event)
  const orgId = user.org
  const b = await readBody(event)
  const { project_id, type, description, amount, date, notes } = b || {}
  const ataStatus = type === 'ata' && ['utkast', 'skickad', 'godkand', 'avbojd'].includes(b?.ata_status) ? b.ata_status : 'utkast'
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
    `INSERT INTO project_line_items (org_id, project_id, type, description, amount, date, notes, ata_status,
       approved_at, approved_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 = 'godkand' THEN now() END, CASE WHEN $8 = 'godkand' THEN $9::int END)
     RETURNING *`,
    [orgId, project_id, type, description.trim(), Number(amount), date || null, notes || null, ataStatus, user.sub]
  )

  await logActivity(
    pool,
    {
      orgId,
      userId: user.sub,
      entityType: 'line_item',
      entityId: rows[0].id,
      projectId: project_id,
      eventType: type === 'ata' ? 'line_item.ata_created' : 'line_item.expense_created',
      metadata: { description: rows[0].description, amount: rows[0].amount, date: rows[0].date },
    },
    { bestEffort: true }
  )

  setResponseStatus(event, 201)
  return rows[0]
})
