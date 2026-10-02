import { pool } from '../../../utils/db'
import { requireAccountant } from '../../../utils/auth'
import { listAccountantProjects } from '../../../utils/accountantAccess'
import { refreshProjectStatuses } from '../../../utils/projectStatus'

// Redovisningsvyn: org:ens alla projekt och ströjobb med kund och ÄTA/utgiftssummor.
export default defineEventHandler(async (event) => {
  const user = requireAccountant(event)
  // Samma härledda status som projektledarna ser i GET /api/projects.
  await refreshProjectStatuses(user.org)
  const projects = await listAccountantProjects(pool, user.org)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { projects }
})
