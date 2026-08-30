import { pool } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import { apiError } from '../utils/http'

// Shallow-merge:a in wizardens framsteg i organizations.onboarding_state.
export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const b = await readBody(event)
  const state = b?.state
  if (state === undefined || state === null || typeof state !== 'object') {
    throw apiError(400, 'Ogiltigt onboarding-tillstånd.')
  }

  const { rows } = await pool.query(
    `UPDATE organizations
     SET onboarding_state = onboarding_state || $2::jsonb
     WHERE id = $1
     RETURNING onboarding_state`,
    [user.org, JSON.stringify(state)]
  )
  return rows[0]
})
