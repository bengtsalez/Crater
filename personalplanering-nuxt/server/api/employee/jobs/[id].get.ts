import { pool } from '../../../utils/db'
import { requireEmployee } from '../../../utils/auth'
import { apiError } from '../../../utils/http'
import { getEmployeeJob } from '../../../utils/employeeAccess'

// Ett arbete (projekt) – bara om personen har en bokning på det. Samma 404
// för "finns inte", "annan org" och "inte tilldelad" så att id:n inte kan sonderas.
export default defineEventHandler(async (event) => {
  const emp = await requireEmployee(event)
  const job = await getEmployeeJob(pool, emp, Number(getRouterParam(event, 'id')))
  if (!job) throw apiError(404, 'Arbetet finns inte eller är inte längre tilldelat dig.')
  setHeader(event, 'Cache-Control', 'private, no-store')
  return job
})
