import { listAtaCandidates } from '../../../../utils/billing'
import { apiError } from '../../../../utils/http'
import { billingRoute, routeId } from '../../../../utils/billingHttp'

export default defineEventHandler((event) =>
  billingRoute(event, async ({ db, ctx }) => {
    const list = await listAtaCandidates(db, ctx.orgId, routeId(event))
    if (!list) throw apiError(404, 'Hittades inte.')
    return list
  })
)
