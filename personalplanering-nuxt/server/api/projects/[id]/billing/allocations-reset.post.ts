import { resetAllocations } from '../../../../utils/billing'
import { billingRoute, billingView, routeId } from '../../../../utils/billingHttp'

export default defineEventHandler((event) =>
  billingRoute(event, async ({ db, ctx }) => {
    const projectId = routeId(event)
    await resetAllocations(db, ctx, projectId)
    return billingView(db, ctx.orgId, projectId)
  })
)
