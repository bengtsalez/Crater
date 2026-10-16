import { inspectionRoutes } from '../../utils/inspectionHttp'

// Aktuella kontroller i hela företaget (filter: project_id, status, responsible_user_id).
export default inspectionRoutes.list('internal')
