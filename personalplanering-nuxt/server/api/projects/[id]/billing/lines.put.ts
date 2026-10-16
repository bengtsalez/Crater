import { saveBaseLines } from '../../../../utils/billing'
import { billingRoute, billingView, routeId } from '../../../../utils/billingHttp'

export default defineEventHandler((event) =>
  billingRoute(event, async ({ db, ctx }) => {
    const projectId = routeId(event)
    const b = (await readBody(event)) || {}
    await saveBaseLines(db, ctx, projectId, b.lines)
    return billingView(db, ctx.orgId, projectId)
  })
)
