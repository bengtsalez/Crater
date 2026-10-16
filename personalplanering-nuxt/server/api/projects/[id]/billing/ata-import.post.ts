import { importAta } from '../../../../utils/billing'
import { billingRoute, billingView, routeId } from '../../../../utils/billingHttp'

export default defineEventHandler((event) =>
  billingRoute(event, async ({ db, ctx }) => {
    const projectId = routeId(event)
    const b = (await readBody(event)) || {}
    const result = await importAta(db, ctx, projectId, b.ids)
    return { ...result, view: await billingView(db, ctx.orgId, projectId) }
  })
)
