import { getPartSnapshot } from '../../../../utils/billing'
import { decryptPnr } from '../../../../utils/billingCrypto'
import { renderBillingPdf, billingPdfFilename } from '../../../../utils/billingPdf'
import { apiError } from '../../../../utils/http'
import { billingRoute, routeId } from '../../../../utils/billingHttp'

// En specifik sparad version av ett underlag.
export default defineEventHandler((event) =>
  billingRoute(event, async ({ db, ctx }) => {
    const docId = routeId(event)
    const { rows } = await db.query('SELECT part_id FROM billing_documents WHERE id = $1 AND org_id = $2', [docId, ctx.orgId])
    if (!rows[0]) throw apiError(404, 'Hittades inte.')
    const snap = await getPartSnapshot(db, ctx.orgId, Number(rows[0].part_id), { documentId: docId })
    if (!snap) throw apiError(404, 'Hittades inte.')
    const bytes = await renderBillingPdf(snap, { decryptPnr })
    setHeader(event, 'Content-Type', 'application/pdf')
    setHeader(event, 'Content-Disposition', `attachment; filename="${billingPdfFilename(snap)}"`)
    setHeader(event, 'Cache-Control', 'no-store')
    return Buffer.from(bytes)
  })
)
