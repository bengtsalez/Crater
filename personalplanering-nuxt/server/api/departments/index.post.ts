import { pool } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { slugifyKey } from '../../utils/departments'
import { apiError } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const b = await readBody(event)
  const label = String(b?.label ?? '').trim()
  if (label.length < 1 || label.length > 40) {
    throw apiError(400, 'Ogiltig avdelningsetikett.')
  }

  const base = slugifyKey(label) || 'avd'
  let key = base
  for (let i = 0; i < 20; i++) {
    const taken = await pool.query('SELECT 1 FROM departments WHERE org_id = $1 AND key = $2', [user.org, key])
    if (!taken.rowCount) break
    key = `${base}-${i + 2}`
  }

  const next = await pool.query(
    'SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM departments WHERE org_id = $1',
    [user.org]
  )

  const { rows } = await pool.query(
    `INSERT INTO departments (org_id, key, label, sort_order)
     VALUES ($1, $2, $3, $4) RETURNING id, org_id, key, label, sort_order`,
    [user.org, key, label, next.rows[0].next]
  )
  setResponseStatus(event, 201)
  return rows[0]
})
