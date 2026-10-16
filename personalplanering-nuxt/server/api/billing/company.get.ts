import { pool } from '../../utils/db'
import { requireBilling } from '../../utils/auth'

// Företagsuppgifter som visas på faktureringsunderlag.
export default defineEventHandler(async (event) => {
  const user = requireBilling(event)
  const { rows } = await pool.query(
    `SELECT name, organization_number, vat_number, address, postal_code, city, email, phone, bankgiro, f_skatt
     FROM organizations WHERE id = $1`,
    [user.org]
  )
  return rows[0]
})
