import { pool } from '../../utils/db'
import { requireOrg } from '../../utils/auth'
import { CUSTOMER_SELECT } from '../../utils/queries'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const q = String(getQuery(event).q ?? '').trim()

  let sql = `${CUSTOMER_SELECT} WHERE c.org_id = $1`
  const params: unknown[] = [orgId]
  if (q) {
    params.push(`%${q}%`)
    sql += ` AND (c.name ILIKE $2 OR c.contact_person ILIKE $2 OR c.email ILIKE $2 OR c.phone ILIKE $2
                  OR c.mobile ILIKE $2 OR c.organization_number ILIKE $2 OR c.address ILIKE $2 OR c.city ILIKE $2)`
  }
  sql += ' ORDER BY c.name'

  const { rows } = await pool.query(sql, params)
  return rows
})
