import { pool, nextProjectNumber, nextSmallJobNumber } from '../../utils/db'
import { requireInternal } from '../../utils/auth'
import { assertDepartmentKey } from '../../utils/departments'
import { resolveCustomer } from '../../utils/customers'
import { PROJECT_SELECT } from '../../utils/queries'
import { apiError } from '../../utils/http'
import { WORK_TYPES, BILLING_TYPES } from '../../utils/projectTypes'
import { logActivity } from '../../utils/activity'
import { normalizeSiteAddress } from '../../utils/projectTypes'

const STATUS_VALUES = ['aktiv', 'planerad', 'klar_att_fakturera', 'avslutad']

export default defineEventHandler(async (event) => {
  const user = requireInternal(event)
  const orgId = user.org
  const b = await readBody(event)
  const {
    name,
    customer_id,
    customer_name,
    client,
    project_manager_user_id,
    sum,
    start_date,
    end_date,
    status_override,
    notes,
    category,
    work_type,
    billing_type,
    source_project_id,
    site_address,
  } = b || {}
  if (!name) {
    throw apiError(400, 'Namn krävs.')
  }
  const workType = work_type !== undefined ? work_type : 'project'
  if (!WORK_TYPES.includes(workType)) throw apiError(400, 'Ogiltig arbetstyp.')
  const billingType = billing_type !== undefined ? billing_type : 'billable'
  if (!BILLING_TYPES.includes(billingType)) throw apiError(400, 'Ogiltig faktureringstyp.')

  let sourceProjectId: number | null = null
  if (source_project_id) {
    const { rows: sourceRows } = await pool.query(
      'SELECT work_type FROM projects WHERE id = $1 AND org_id = $2',
      [source_project_id, orgId]
    )
    if (!sourceRows[0] || sourceRows[0].work_type !== 'project') {
      throw apiError(400, 'Ogiltigt relaterat projekt.')
    }
    sourceProjectId = source_project_id
  }

  const override = status_override && STATUS_VALUES.includes(status_override) ? status_override : null
  await assertDepartmentKey(pool, orgId, category)

  if (project_manager_user_id) {
    const { rowCount } = await pool.query(
      "SELECT 1 FROM users WHERE id = $1 AND org_id = $2 AND role NOT IN ('employee', 'accountant')",
      [project_manager_user_id, orgId]
    )
    if (!rowCount) throw apiError(400, 'Ogiltig projektledare.')
  }

  const project_number = workType === 'small_job' ? await nextSmallJobNumber(orgId) : await nextProjectNumber(orgId)

  // Kundkoppling (hitta-eller-skapa) och projekt-INSERT sker i samma transaktion
  // så att ett fel aldrig lämnar en nyskapad kund utan projekt eller tvärtom.
  const conn = await pool.connect()
  let projectId: number
  try {
    await conn.query('BEGIN')
    const customer = await resolveCustomer(conn, orgId, { customer_id, customer_name, client })
    // Nyskapat projekt är alltid "aktiv" (inga bokningar ännu). En ev. manuell
    // override kan sättas direkt; annars styr automatiken framåt.
    const inserted = await conn.query(
      `INSERT INTO projects (org_id, project_number, name, customer_id, client, project_manager_user_id, sum, start_date, end_date, status, status_override, notes, category, work_type, billing_type, source_project_id, site_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [
        orgId,
        project_number,
        name,
        customer.id,
        customer.name,
        project_manager_user_id || null,
        sum === '' || sum === undefined ? null : sum,
        start_date || null,
        end_date || null,
        override || 'aktiv',
        override,
        notes || null,
        category || null,
        workType,
        billingType,
        sourceProjectId,
        normalizeSiteAddress(site_address),
      ]
    )
    projectId = inserted.rows[0].id
    await logActivity(conn, {
      orgId,
      userId: user.sub,
      entityType: 'project',
      entityId: projectId,
      projectId,
      eventType: workType === 'small_job' ? 'small_job.created' : 'project.created',
      metadata: {
        name,
        project_number,
        work_type: workType,
        billing_type: billingType,
        sum: sum === '' || sum === undefined ? null : sum,
        customer_name: customer.name,
        start_date: start_date || null,
        end_date: end_date || null,
      },
    })
    await conn.query('COMMIT')
  } catch (err) {
    await conn.query('ROLLBACK')
    throw err
  } finally {
    conn.release()
  }

  const { rows } = await pool.query(`${PROJECT_SELECT} WHERE p.id = $1`, [projectId])
  setResponseStatus(event, 201)
  return rows[0]
})
