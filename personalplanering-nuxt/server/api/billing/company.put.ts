import { pool } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { apiError } from '../../utils/http'
import { logActivity } from '../../utils/activity'

const FIELDS = ['organization_number', 'vat_number', 'address', 'postal_code', 'city', 'email', 'phone', 'bankgiro'] as const

// Företagsuppgifter för faktureringsunderlag – endast admin (org-ägare).
export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const b = (await readBody(event)) || {}
  const values: (string | null)[] = []
  for (const f of FIELDS) {
    const v = b[f] === undefined || b[f] === null ? '' : String(b[f]).trim()
    if (v.length > 200) throw apiError(400, 'För långt värde.')
    values.push(v || null)
  }
  const { rows } = await pool.query(
    `UPDATE organizations SET organization_number=$2, vat_number=$3, address=$4, postal_code=$5, city=$6,
       email=$7, phone=$8, bankgiro=$9, f_skatt=$10
     WHERE id = $1
     RETURNING name, organization_number, vat_number, address, postal_code, city, email, phone, bankgiro, f_skatt`,
    [user.org, ...values, !!b.f_skatt]
  )
  await logActivity(
    pool,
    { orgId: user.org, userId: user.sub, entityType: 'organization', entityId: user.org, eventType: 'billing.company_updated' },
    { bestEffort: true }
  )
  return rows[0]
})
