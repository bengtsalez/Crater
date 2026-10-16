import { getPartRecipientsPlain } from '../../../../utils/billing'
import { decryptPnr } from '../../../../utils/billingCrypto'
import { apiError } from '../../../../utils/http'
import { billingRoute, routeId, projectOfPart } from '../../../../utils/billingHttp'

// Delens ROT-mottagare med personnummer i klartext – endast för redigering.
export default defineEventHandler((event) =>
  billingRoute(event, async ({ db, ctx }) => {
    const partId = routeId(event)
    await projectOfPart(db, ctx.orgId, partId)
    const recipients = await getPartRecipientsPlain(db, ctx.orgId, partId, decryptPnr)
    if (!recipients) throw apiError(404, 'Hittades inte.')
    setHeader(event, 'Cache-Control', 'no-store')
    return { id: partId, rot_recipients: recipients }
  })
)
