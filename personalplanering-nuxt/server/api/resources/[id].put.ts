import { pool } from '../../utils/db'
import { requireOrg } from '../../utils/auth'
import { resolveResourceCategory, resolveColor } from '../../utils/domain'
import { assertDepartmentKey } from '../../utils/departments'
import { apiError } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = getRouterParam(event, 'id')
  const b = await readBody(event)
  const { name, type, phone, active } = b || {}

  const existingResult = await pool.query('SELECT * FROM resources WHERE id = $1 AND org_id = $2', [id, orgId])
  const existing = existingResult.rows[0]
  if (!existing) throw apiError(404, 'Hittades inte.')

  const newType = type ?? existing.type
  const newCategory = b.category !== undefined ? b.category : existing.category
  if (newType === 'anstalld' && !newCategory) {
    throw apiError(400, 'Giltig kategori krävs för anställda.')
  }
  await assertDepartmentKey(pool, orgId, newType === 'anstalld' ? newCategory : null)

  const category = resolveResourceCategory(newType, newCategory)
  const color = b.color !== undefined ? resolveColor(b.color) : existing.color

  const { rows } = await pool.query(
    'UPDATE resources SET name=$1, type=$2, category=$3, phone=$4, active=$5, color=$6 WHERE id=$7 AND org_id=$8 RETURNING *',
    [
      name ?? existing.name,
      newType,
      category,
      phone ?? existing.phone,
      active === undefined ? existing.active : active ? 1 : 0,
      color,
      id,
      orgId,
    ]
  )
  return rows[0]
})
