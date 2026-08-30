import { pool } from '../utils/db'
import { requireOrg } from '../utils/auth'
import { resolveResourceCategory, resolveColor } from '../utils/domain'
import { assertDepartmentKey } from '../utils/departments'
import { apiError } from '../utils/http'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const b = await readBody(event)
  const { name, type, phone, active } = b || {}
  if (!name || !['anstalld', 'underentreprenor'].includes(type)) {
    throw apiError(400, 'Namn och giltig typ krävs.')
  }
  if (type === 'anstalld' && !b.category) {
    throw apiError(400, 'Giltig kategori krävs för anställda.')
  }
  await assertDepartmentKey(pool, orgId, type === 'anstalld' ? b.category : null)

  const category = resolveResourceCategory(type, b.category)
  const { rows } = await pool.query(
    `INSERT INTO resources (org_id, name, type, category, phone, active, color)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [orgId, name, type, category, phone || null, active === false ? 0 : 1, resolveColor(b.color)]
  )
  setResponseStatus(event, 201)
  return rows[0]
})
