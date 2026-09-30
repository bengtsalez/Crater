import { pool } from '../../../utils/db'
import { requireEmployee } from '../../../utils/auth'
import { apiError } from '../../../utils/http'
import { logActivity } from '../../../utils/activity'
import { EMPLOYEE_TASK_STATUSES, setEmployeeTaskStatus } from '../../../utils/employeeAccess'

// Personalen får bara ändra STATUS på sina egna uppgifter i arbeten de är
// bokade på. Titel, instruktion och deadline ägs av projektledaren.
export default defineEventHandler(async (event) => {
  const emp = await requireEmployee(event)
  const b = await readBody(event)
  const status = String(b?.status ?? '')
  if (!(EMPLOYEE_TASK_STATUSES as readonly string[]).includes(status)) {
    throw apiError(400, 'Ogiltig status.')
  }

  const result = await setEmployeeTaskStatus(pool, emp, Number(getRouterParam(event, 'id')), status)
  if (!result) throw apiError(404, 'Hittades inte.')

  if (result.previous.status !== status) {
    await logActivity(
      pool,
      {
        orgId: emp.org,
        userId: emp.userId,
        entityType: 'task',
        entityId: result.task.id,
        projectId: result.previous.project_id,
        eventType: status === 'avslutad' ? 'task.completed' : 'task.reopened',
        metadata: { title: result.previous.title },
      },
      { bestEffort: true }
    )
  }

  return result.task
})
