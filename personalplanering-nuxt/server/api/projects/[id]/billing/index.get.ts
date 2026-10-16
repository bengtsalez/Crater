import { billingRoute, billingView, routeId } from '../../../../utils/billingHttp'

export default defineEventHandler((event) =>
  billingRoute(event, ({ db, ctx }) => billingView(db, ctx.orgId, routeId(event)))
)
