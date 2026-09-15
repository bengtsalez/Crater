import { pool } from '../../../utils/db'
import { requireOrg } from '../../../utils/auth'
import { assertDepartmentKey } from '../../../utils/departments'
import { resolveCustomer } from '../../../utils/customers'
import { PROJECT_SELECT } from '../../../utils/queries'
import { apiError } from '../../../utils/http'
import { refreshProjectStatuses } from '../../../utils/projectStatus'
import { BILLING_TYPES } from '../../../utils/projectTypes'

const STATUS_VALUES = ['aktiv', 'planerad', 'klar_att_fakturera', 'avslutad']

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const id = getRouterParam(event, 'id')
  const existingResult = await pool.query('SELECT * FROM projects WHERE id = $1 AND org_id = $2', [id, orgId])
  const existing = existingResult.rows[0]
  if (!existing) throw apiError(404, 'Hittades inte.')

  const b = await readBody(event)
  if (b.category) {
    await assertDepartmentKey(pool, orgId, b.category)
  }

  const newPm =
    b.project_manager_user_id !== undefined ? b.project_manager_user_id : existing.project_manager_user_id
  if (newPm) {
    const { rowCount } = await pool.query('SELECT 1 FROM users WHERE id = $1 AND org_id = $2', [newPm, orgId])
    if (!rowCount) throw apiError(400, 'Ogiltig projektledare.')
  }

  let billingType = existing.billing_type
  if (b.billing_type !== undefined) {
    if (!BILLING_TYPES.includes(b.billing_type)) throw apiError(400, 'Ogiltig faktureringstyp.')
    billingType = b.billing_type
  }

  let sourceProjectId = existing.source_project_id
  if (b.source_project_id !== undefined) {
    if (b.source_project_id === null) {
      sourceProjectId = null
    } else {
      const { rows: sourceRows } = await pool.query(
        'SELECT work_type FROM projects WHERE id = $1 AND org_id = $2',
        [b.source_project_id, orgId]
      )
      if (!sourceRows[0] || sourceRows[0].work_type !== 'project') {
        throw apiError(400, 'Ogiltigt relaterat projekt.')
      }
      sourceProjectId = b.source_project_id
    }
  }
  // `work_type` sätts bara vid skapande – byte av typ på ett befintligt projekt stöds inte.

  // `status` styrs av automatiken (refreshProjectStatuses nedan). Klienten sätter
  // bara `status_override`: en giltig statussträng tvingar värdet, tomt/null släpper
  // det fritt igen. Bakåtkompat: en gammal klient som skickar `status` tolkas som override.
  let override: string | null
  if (b.status_override !== undefined) {
    override = STATUS_VALUES.includes(b.status_override) ? b.status_override : null
  } else if (typeof b.status === 'string' && STATUS_VALUES.includes(b.status)) {
    override = b.status
  } else {
    override = existing.status_override
  }

  // Kundkoppling omprövas bara om requesten faktiskt rör vid den – annars behålls
  // befintlig koppling oförändrad. Explicit tom/null kund kopplar loss projektet.
  const touchesCustomer = b.customer_id !== undefined || b.customer_name !== undefined || b.client !== undefined

  const conn = await pool.connect()
  try {
    await conn.query('BEGIN')
    const customer = touchesCustomer
      ? await resolveCustomer(conn, orgId, { customer_id: b.customer_id, customer_name: b.customer_name, client: b.client })
      : { id: existing.customer_id, name: existing.client }

    await conn.query(
      `UPDATE projects SET project_number=$1, name=$2, customer_id=$3, client=$4, project_manager_user_id=$5, sum=$6, start_date=$7, end_date=$8, status_override=$9, notes=$10, category=$11, billing_type=$12, source_project_id=$13
       WHERE id=$14 AND org_id=$15`,
      [
        b.project_number ?? existing.project_number,
        b.name ?? existing.name,
        customer.id,
        customer.name,
        newPm,
        b.sum === '' ? null : b.sum ?? existing.sum,
        b.start_date ?? existing.start_date,
        b.end_date ?? existing.end_date,
        override,
        b.notes ?? existing.notes,
        b.category !== undefined ? b.category || null : existing.category,
        billingType,
        sourceProjectId,
        id,
        orgId,
      ]
    )
    await conn.query('COMMIT')
  } catch (err) {
    await conn.query('ROLLBACK')
    throw err
  } finally {
    conn.release()
  }

  await refreshProjectStatuses(orgId)
  const { rows } = await pool.query(`${PROJECT_SELECT} WHERE p.id = $1`, [id])
  return rows[0]
})
