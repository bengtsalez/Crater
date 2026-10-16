import { deletePart } from '../../../../utils/billing'
import { billingRoute, billingView, routeId, projectOfPart } from '../../../../utils/billingHttp'

export default defineEventHandler((event) =>
  billingRoute(event, async ({ db, ctx }) => {
    const partId = routeId(event)
    const projectId = await projectOfPart(db, ctx.orgId, partId)
    await deletePart(db, ctx, partId)
    return billingView(db, ctx.orgId, projectId)
  })
)
