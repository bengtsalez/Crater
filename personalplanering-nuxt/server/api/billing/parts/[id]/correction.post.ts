import { createCorrection } from '../../../../utils/billing'
import { billingRoute, billingView, routeId, projectOfPart } from '../../../../utils/billingHttp'

export default defineEventHandler((event) =>
  billingRoute(event, async ({ db, ctx }) => {
    const partId = routeId(event)
    const projectId = await projectOfPart(db, ctx.orgId, partId)
    const { id } = await createCorrection(db, ctx, partId)
    return { id, view: await billingView(db, ctx.orgId, projectId) }
  })
)
