import { inspectionHandler } from '../../utils/inspectionHttp'
import { createTemplate } from '../../utils/inspectionTemplates'

export default inspectionHandler('internal', async (c) => {
  setResponseStatus(c.event, 201)
  return createTemplate(c.db, c.actor, (await readBody(c.event)) || {})
})
