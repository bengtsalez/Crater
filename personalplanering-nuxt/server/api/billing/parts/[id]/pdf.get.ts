import { getPartSnapshot } from '../../../../utils/billing'
import { decryptPnr } from '../../../../utils/billingCrypto'
import { renderBillingPdf, billingPdfFilename } from '../../../../utils/billingPdf'
import { apiError } from '../../../../utils/http'
import { billingRoute, routeId } from '../../../../utils/billingHttp'

// Fakturerad del → senaste sparade (oföränderliga) versionen. Öppen del → utkast.
export default defineEventHandler((event) =>
  billingRoute(event, async ({ db, ctx }) => {
    const snap = await getPartSnapshot(db, ctx.orgId, routeId(event))
    if (!snap) throw apiError(404, 'Hittades inte.')
    const bytes = await renderBillingPdf(snap, { decryptPnr })
    setHeader(event, 'Content-Type', 'application/pdf')
    setHeader(event, 'Content-Disposition', `attachment; filename="${billingPdfFilename(snap)}"`)
    setHeader(event, 'Cache-Control', 'no-store')
    return Buffer.from(bytes)
  })
)
