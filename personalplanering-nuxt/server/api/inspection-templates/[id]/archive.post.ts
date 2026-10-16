import { inspectionHandler } from '../../../utils/inspectionHttp'
import { setTemplateArchived } from '../../../utils/inspectionTemplates'

// { archived: true | false }
export default inspectionHandler('internal', async (c) => {
  const b = (await readBody(c.event)) || {}
  return setTemplateArchived(c.db, c.actor, getRouterParam(c.event, 'id'), b.archived !== false)
})
