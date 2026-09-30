import { pool } from '../../../utils/db'
import { requireInternal } from '../../../utils/auth'
import { apiError } from '../../../utils/http'
import { logActivity } from '../../../utils/activity'

const MAX_INSTRUCTIONS = 20000

export default defineEventHandler(async (event) => {
  const user = requireInternal(event)
  const id = Number(getRouterParam(event, 'id'))
  const { rowCount } = await pool.query('SELECT 1 FROM projects WHERE id = $1 AND org_id = $2', [id, user.org])
  if (!rowCount) throw apiError(404, 'Hittades inte.')

  const b = (await readBody(event)) || {}
  // Ren text – normalisera radbrytningar; renderas säkert (utan v-html) i klienten.
  const instructions = String(b.instructions ?? '').replace(/\r\n?/g, '\n').trimEnd()
  if (instructions.length > MAX_INSTRUCTIONS) {
    throw apiError(400, `Instruktionerna får vara högst ${MAX_INSTRUCTIONS} tecken.`)
  }
  const published = Boolean(b.published)

  const { rows: prevRows } = await pool.query(
    'SELECT instructions, published FROM project_staff_info WHERE project_id = $1 AND org_id = $2',
    [id, user.org]
  )
  const prev = prevRows[0] ?? { instructions: '', published: false }

  await pool.query(
    `INSERT INTO project_staff_info (project_id, org_id, instructions, published, updated_by_user_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (project_id) DO UPDATE
       SET instructions = EXCLUDED.instructions, published = EXCLUDED.published,
           updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
     WHERE project_staff_info.org_id = EXCLUDED.org_id`,
    [id, user.org, instructions || null, published, user.sub]
  )

  const events: string[] = []
  if ((prev.instructions || '') !== instructions) events.push('staff_info.updated')
  if (Boolean(prev.published) !== published) events.push(published ? 'staff_info.published' : 'staff_info.unpublished')
  for (const eventType of events) {
    await logActivity(
      pool,
      { orgId: user.org, userId: user.sub, entityType: 'project', entityId: id, projectId: id, eventType },
      { bestEffort: true }
    )
  }

  const { rows } = await pool.query(
    `SELECT s.instructions, s.published, s.updated_at, u.username AS updated_by_username
     FROM project_staff_info s
     LEFT JOIN users u ON u.id = s.updated_by_user_id AND u.org_id = s.org_id
     WHERE s.project_id = $1 AND s.org_id = $2`,
    [id, user.org]
  )
  return rows[0]
})
