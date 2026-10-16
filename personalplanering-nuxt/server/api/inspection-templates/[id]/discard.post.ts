import { inspectionHandler } from '../../../utils/inspectionHttp'
import { discardTemplateDraft } from '../../../utils/inspectionTemplates'

export default inspectionHandler('internal', async (c) => {
  const b = (await readBody(c.event)) || {}
  return discardTemplateDraft(c.db, c.actor, getRouterParam(c.event, 'id'), b.draft_rev)
})
