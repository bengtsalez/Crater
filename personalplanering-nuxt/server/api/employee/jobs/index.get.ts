import { pool } from '../../../utils/db'
import { requireEmployee } from '../../../utils/auth'
import { listEmployeeJobs, stockholmToday } from '../../../utils/employeeAccess'

// Mina arbeten: den inloggades egna bokningar ur ordinarie planering.
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (valfritt) – annars allt från idag och framåt.
export default defineEventHandler(async (event) => {
  const emp = await requireEmployee(event)
  const q = getQuery(event)
  const today = stockholmToday()
  const jobs = await listEmployeeJobs(pool, emp, {
    from: typeof q.from === 'string' ? q.from : null,
    to: typeof q.to === 'string' ? q.to : null,
    today,
  })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { today, jobs }
})
