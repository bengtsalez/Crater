import { pool } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'
import { CUSTOMER_SELECT } from '../../../utils/queries'
import { apiError } from '../../../utils/http'
import { logActivity } from '../../../utils/activity'
import { buildCustomerUpdateEvent, type CustomerDiffRow } from '../../../utils/activityDiff'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const orgId = user.org
  const id = getRouterParam(event, 'id')
  const existingResult = await pool.query('SELECT * FROM customers WHERE id = $1 AND org_id = $2', [id, orgId])
  const existing = existingResult.rows[0]
  if (!existing) throw apiError(404, 'Hittades inte.')

  const b = await readBody(event)
  const name = b.name !== undefined ? String(b.name).trim() : existing.name
  if (!name) throw apiError(400, 'Kundnamn krävs.')
  const nameChanged = name !== existing.name

  const conn = await pool.connect()
  try {
    await conn.query('BEGIN')
    await conn.query(
      `UPDATE customers SET
         name=$1, customer_type=$2, organization_number=$3, contact_person=$4, email=$5, phone=$6, mobile=$7,
         address=$8, postal_code=$9, city=$10, billing_address=$11, billing_postal_code=$12, billing_city=$13,
         billing_email=$14, invoice_reference=$15, notes=$16, updated_at=now()
       WHERE id=$17 AND org_id=$18`,
      [
        name,
        b.customer_type !== undefined ? b.customer_type || null : existing.customer_type,
        b.organization_number !== undefined ? b.organization_number || null : existing.organization_number,
        b.contact_person !== undefined ? b.contact_person || null : existing.contact_person,
        b.email !== undefined ? b.email || null : existing.email,
        b.phone !== undefined ? b.phone || null : existing.phone,
        b.mobile !== undefined ? b.mobile || null : existing.mobile,
        b.address !== undefined ? b.address || null : existing.address,
        b.postal_code !== undefined ? b.postal_code || null : existing.postal_code,
        b.city !== undefined ? b.city || null : existing.city,
        b.billing_address !== undefined ? b.billing_address || null : existing.billing_address,
        b.billing_postal_code !== undefined ? b.billing_postal_code || null : existing.billing_postal_code,
        b.billing_city !== undefined ? b.billing_city || null : existing.billing_city,
        b.billing_email !== undefined ? b.billing_email || null : existing.billing_email,
        b.invoice_reference !== undefined ? b.invoice_reference || null : existing.invoice_reference,
        b.notes !== undefined ? b.notes || null : existing.notes,
        id,
        orgId,
      ]
    )
    // `client` på projects är en spegel av kundens namn – håll den sann vid namnbyte
    // så att bakåtkompatibla läsplatser (t.ex. gamla appen, ännu ej migrerade vyer)
    // aldrig visar ett inaktuellt namn.
    if (nameChanged) {
      await conn.query('UPDATE projects SET client = $1 WHERE customer_id = $2 AND org_id = $3', [name, id, orgId])
    }

    const existingDiff: CustomerDiffRow = {
      name: existing.name,
      customer_type: existing.customer_type,
      organization_number: existing.organization_number,
      contact_person: existing.contact_person,
      email: existing.email,
      phone: existing.phone,
      mobile: existing.mobile,
      address: existing.address,
      postal_code: existing.postal_code,
      city: existing.city,
      billing_address: existing.billing_address,
      billing_postal_code: existing.billing_postal_code,
      billing_city: existing.billing_city,
      billing_email: existing.billing_email,
      invoice_reference: existing.invoice_reference,
      notes: existing.notes,
    }
    const nextDiff: CustomerDiffRow = {
      name,
      customer_type: b.customer_type !== undefined ? b.customer_type || null : existing.customer_type,
      organization_number: b.organization_number !== undefined ? b.organization_number || null : existing.organization_number,
      contact_person: b.contact_person !== undefined ? b.contact_person || null : existing.contact_person,
      email: b.email !== undefined ? b.email || null : existing.email,
      phone: b.phone !== undefined ? b.phone || null : existing.phone,
      mobile: b.mobile !== undefined ? b.mobile || null : existing.mobile,
      address: b.address !== undefined ? b.address || null : existing.address,
      postal_code: b.postal_code !== undefined ? b.postal_code || null : existing.postal_code,
      city: b.city !== undefined ? b.city || null : existing.city,
      billing_address: b.billing_address !== undefined ? b.billing_address || null : existing.billing_address,
      billing_postal_code: b.billing_postal_code !== undefined ? b.billing_postal_code || null : existing.billing_postal_code,
      billing_city: b.billing_city !== undefined ? b.billing_city || null : existing.billing_city,
      billing_email: b.billing_email !== undefined ? b.billing_email || null : existing.billing_email,
      invoice_reference: b.invoice_reference !== undefined ? b.invoice_reference || null : existing.invoice_reference,
      notes: b.notes !== undefined ? b.notes || null : existing.notes,
    }
    const updateEvent = buildCustomerUpdateEvent(existingDiff, nextDiff)
    if (updateEvent) {
      await logActivity(conn, {
        orgId,
        userId: user.sub,
        entityType: 'customer',
        entityId: Number(id),
        customerId: Number(id),
        eventType: updateEvent.eventType,
        metadata: updateEvent.metadata,
      })
    }

    await conn.query('COMMIT')
  } catch (err) {
    await conn.query('ROLLBACK')
    if ((err as { code?: string }).code === '23505') {
      throw apiError(409, 'En kund med det namnet finns redan.')
    }
    throw err
  } finally {
    conn.release()
  }

  const { rows } = await pool.query(`${CUSTOMER_SELECT} WHERE c.id = $1`, [id])
  return rows[0]
})
