import { inspectionHandler } from '../../../utils/inspectionHttp'
import { duplicateTemplate } from '../../../utils/inspectionTemplates'

export default inspectionHandler('internal', async (c) => {
  setResponseStatus(c.event, 201)
  return duplicateTemplate(c.db, c.actor, getRouterParam(c.event, 'id'))
})
