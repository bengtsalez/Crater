import { inspectionHandler } from '../../../utils/inspectionHttp'
import { publishTemplate } from '../../../utils/inspectionTemplates'

export default inspectionHandler('internal', async (c) => {
  const b = (await readBody(c.event)) || {}
  return publishTemplate(c.db, c.actor, getRouterParam(c.event, 'id'), b.draft_rev)
})
