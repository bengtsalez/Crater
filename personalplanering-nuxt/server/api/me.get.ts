import { pool } from '../utils/db'
import { requireUser } from '../utils/auth'
import { findEmployeeResource } from '../utils/employeeAccess'

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const { rows } = await pool.query(
    'SELECT id, name, app_title, onboarded_at, onboarding_state FROM organizations WHERE id = $1',
    [user.org]
  )
  const org = rows[0] ?? null

  if (user.role === 'employee') {
    // Personal ser bara namn/titel – inget onboarding-tillstånd. Resursen
    // (id + namn) avgör om kontot har åtkomst till arbetsdata.
    const resource = user.resourceId ? await findEmployeeResource(pool, user.org, user.resourceId) : null
    return {
      id: user.sub,
      username: user.username,
      role: user.role,
      resource,
      org: org ? { id: org.id, name: org.name, app_title: org.app_title, onboarded_at: org.onboarded_at } : null,
    }
  }

  if (user.role === 'accountant') {
    return {
      id: user.sub,
      username: user.username,
      role: user.role,
      resource: null,
      org: org ? { id: org.id, name: org.name, app_title: org.app_title, onboarded_at: org.onboarded_at } : null,
    }
  }

  return {
    id: user.sub,
    username: user.username,
    role: user.role,
    resource: null,
    org,
  }
})
