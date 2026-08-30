import { pool, highestProjectNumber } from '../../utils/db'
import { requireOrg } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const highest = await highestProjectNumber(pool, orgId)
  return { next: 'P' + (highest + 1) }
})
