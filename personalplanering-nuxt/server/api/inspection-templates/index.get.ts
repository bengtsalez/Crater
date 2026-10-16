import { inspectionHandler } from '../../utils/inspectionHttp'
import { listTemplates } from '../../utils/inspectionTemplates'

// admin: ?all=1 visar även utkast och arkiverade.
export default inspectionHandler('internal', (c) =>
  listTemplates(c.db, c.actor, { includeArchived: getQuery(c.event).all === '1' })
)
