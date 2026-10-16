import { inspectionHandler } from '../../../utils/inspectionHttp'
import { saveTemplateDraft } from '../../../utils/inspectionTemplates'

// Sparar utkastet. draft_rev = revisionen formuläret utgår från.
export default inspectionHandler('internal', async (c) => {
  const b = (await readBody(c.event)) || {}
  return saveTemplateDraft(c.db, c.actor, getRouterParam(c.event, 'id'), b.content, b.draft_rev)
})
