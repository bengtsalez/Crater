import { inspectionHandler } from '../../../utils/inspectionHttp'
import { getTemplate } from '../../../utils/inspectionTemplates'

export default inspectionHandler('internal', (c) => getTemplate(c.db, c.actor, getRouterParam(c.event, 'id')))
