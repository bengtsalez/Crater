import { pool } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { apiError } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const b = await readBody(event)
  const ids: unknown = b?.ids
  if (!Array.isArray(ids) || ids.some((x) => !Number.isInteger(x))) {
    throw apiError(400, 'Ogiltig ordning.')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        'UPDATE departments SET sort_order = $1 WHERE id = $2 AND org_id = $3',
        [i, ids[i], user.org]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const { rows } = await pool.query(
    'SELECT id, org_id, key, label, sort_order FROM departments WHERE org_id = $1 ORDER BY sort_order, id',
    [user.org]
  )
  return rows
})
