import { pool, highestProjectNumber, nextSmallJobNumber } from '../../utils/db'
import { requireOrg } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const orgId = requireOrg(event)
  const query = getQuery(event)
  if (query.type === 'small_job') {
    return { next: await nextSmallJobNumber(orgId) }
  }
  const highest = await highestProjectNumber(pool, orgId)
  return { next: 'P' + (highest + 1) }
})
