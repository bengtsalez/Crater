import { pool } from '../../../utils/db'
import { requireInternal } from '../../../utils/auth'
import { assertDepartmentKey } from '../../../utils/departments'
import { resolveCustomer } from '../../../utils/customers'
import { PROJECT_SELECT } from '../../../utils/queries'
import { apiError } from '../../../utils/http'
import { refreshProjectStatuses } from '../../../utils/projectStatus'
import { BILLING_TYPES, normalizeSiteAddress } from '../../../utils/projectTypes'
import { logActivity } from '../../../utils/activity'
import { buildProjectUpdateEvent, type ProjectDiffRow } from '../../../utils/activityDiff'

const STATUS_VALUES = ['aktiv', 'planerad', 'klar_att_fakturera', 'avslutad']

export default defineEventHandler(async (event) => {
  const user = requireInternal(event)
  const orgId = user.org
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
  let newPmUsername: string | null = null
  if (newPm) {
    const { rows } = await pool.query('SELECT username, role FROM users WHERE id = $1 AND org_id = $2', [newPm, orgId])
    if (!rows[0]) throw apiError(400, 'Ogiltig projektledare.')
    // Personalkonton kan inte vara projektledare (befintlig koppling får ligga kvar).
    if (rows[0].role === 'employee' && newPm !== existing.project_manager_user_id) throw apiError(400, 'Ogiltig projektledare.')
    newPmUsername = rows[0].username
  }
  // Bara för aktivitetsloggens diff – "gammal PM"-namnet syns inte annars om
  // den nya raden bara har det nya id:t.
  let oldPmUsername: string | null = null
  if (existing.project_manager_user_id) {
    const { rows } = await pool.query('SELECT username FROM users WHERE id = $1', [existing.project_manager_user_id])
    oldPmUsername = rows[0]?.username ?? null
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
  const siteAddress = b.site_address !== undefined ? normalizeSiteAddress(b.site_address) : existing.site_address

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
      `UPDATE projects SET project_number=$1, name=$2, customer_id=$3, client=$4, project_manager_user_id=$5, sum=$6, start_date=$7, end_date=$8, status_override=$9, notes=$10, category=$11, billing_type=$12, source_project_id=$13, site_address=$14
       WHERE id=$15 AND org_id=$16`,
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
        siteAddress,
        id,
        orgId,
      ]
    )

    const existingDiff: ProjectDiffRow = {
      name: existing.name,
      start_date: existing.start_date,
      end_date: existing.end_date,
      sum: existing.sum,
      notes: existing.notes,
      category: existing.category,
      billing_type: existing.billing_type,
      status_override: existing.status_override,
      customer_name: existing.client,
      project_manager_username: oldPmUsername,
      site_address: existing.site_address,
    }
    const nextDiff: ProjectDiffRow = {
      name: b.name ?? existing.name,
      start_date: b.start_date ?? existing.start_date,
      end_date: b.end_date ?? existing.end_date,
      sum: b.sum === '' ? null : b.sum ?? existing.sum,
      notes: b.notes ?? existing.notes,
      category: b.category !== undefined ? b.category || null : existing.category,
      billing_type: billingType,
      status_override: override,
      customer_name: customer.name,
      project_manager_username: newPmUsername,
      site_address: siteAddress,
    }
    const updateEvent = buildProjectUpdateEvent(existingDiff, nextDiff)
    if (updateEvent) {
      await logActivity(conn, {
        orgId,
        userId: user.sub,
        entityType: 'project',
        entityId: Number(id),
        projectId: Number(id),
        eventType: updateEvent.eventType,
        metadata: updateEvent.metadata,
      })
    }

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
