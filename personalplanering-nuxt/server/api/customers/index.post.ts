import { pool } from '../../utils/db'
import { requireOrg } from '../../utils/auth'
import { CUSTOMER_SELECT } from '../../utils/queries'
import { apiError } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const b = await readBody(event)
  const name = String(b?.name ?? '').trim()
  if (name.length < 1 || name.length > 200) {
    throw apiError(400, 'Kundnamn krävs.')
  }

  const inserted = await pool.query(
    `INSERT INTO customers (
       org_id, name, customer_type, organization_number, contact_person, email, phone, mobile,
       address, postal_code, city, billing_address, billing_postal_code, billing_city, billing_email,
       invoice_reference, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (org_id, name_key) DO NOTHING
     RETURNING id`,
    [
      orgId,
      name,
      b.customer_type || null,
      b.organization_number || null,
      b.contact_person || null,
      b.email || null,
      b.phone || null,
      b.mobile || null,
      b.address || null,
      b.postal_code || null,
      b.city || null,
      b.billing_address || null,
      b.billing_postal_code || null,
      b.billing_city || null,
      b.billing_email || null,
      b.invoice_reference || null,
      b.notes || null,
    ]
  )
  if (!inserted.rows[0]) {
    throw apiError(409, 'En kund med det namnet finns redan.')
  }

  const { rows } = await pool.query(`${CUSTOMER_SELECT} WHERE c.id = $1`, [inserted.rows[0].id])
  setResponseStatus(event, 201)
  return rows[0]
})
