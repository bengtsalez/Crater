import { inspectionHandler } from '../../utils/inspectionHttp'
import { importExampleTemplates } from '../../utils/inspectionTemplates'

// "Lägg till exempelmallar" – idempotent per företag.
export default inspectionHandler('internal', (c) => importExampleTemplates(c.db, c.actor))
