import { pool } from '../../../utils/db'
import { requireAccountant } from '../../../utils/auth'
import { apiError } from '../../../utils/http'
import { getAccountantProject } from '../../../utils/accountantAccess'

// Ett projekt med fullständiga kund- och faktureringsuppgifter samt ÄTA/utgifter.
export default defineEventHandler(async (event) => {
  const user = requireAccountant(event)
  const project = await getAccountantProject(pool, user.org, Number(getRouterParam(event, 'id')))
  if (!project) throw apiError(404, 'Projektet finns inte.')
  setHeader(event, 'Cache-Control', 'private, no-store')
  return project
})
