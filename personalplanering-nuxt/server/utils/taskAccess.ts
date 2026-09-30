import type { Pool } from 'pg'
import { apiError } from './http'
import type { SessionPayload } from './auth'

type Queryable = { query: Pool['query'] }

// Uppgifter är i grunden personliga (tasks.user_id = mottagaren). Undantaget
// är personalkonton: interna användare (projektledare) får skapa, ändra och ta
// bort uppgifter som är tilldelade personal i samma org. Personalen själv
// ändrar bara status via /api/employee/tasks/:id.

async function isEmployeeInOrg(db: Queryable, orgId: number, userId: number): Promise<boolean> {
  const { rows } = await db.query("SELECT 1 FROM users WHERE id = $1 AND org_id = $2 AND role = 'employee'", [
    userId,
    orgId,
  ])
  return rows.length > 0
}

// Mottagare för en ny/ändrad uppgift. Tomt eller eget id → den inloggade.
// Annan mottagare måste vara ett personalkonto i samma org, och uppgiften
// måste höra till ett projekt (annars syns den aldrig i personalvyn).
export async function resolveTaskAssignee(
  db: Queryable,
  caller: SessionPayload,
  requested: unknown,
  projectId: unknown
): Promise<number> {
  if (requested === undefined || requested === null || requested === '') return caller.sub
  const id = Number(requested)
  if (id === caller.sub) return caller.sub
  if (!Number.isInteger(id) || !(await isEmployeeInOrg(db, caller.org, id))) {
    throw apiError(400, 'Uppgifter kan bara tilldelas dig själv eller ett personalkonto.')
  }
  if (!projectId) throw apiError(400, 'Uppgifter till personal måste kopplas till ett projekt.')
  return id
}

// Egen uppgift, eller en uppgift tilldelad ett personalkonto i samma org.
export async function canManageTask(
  db: Queryable,
  caller: SessionPayload,
  task: { user_id: number; org_id: number | string }
): Promise<boolean> {
  if (Number(task.org_id) !== caller.org) return false
  if (task.user_id === caller.sub) return true
  return isEmployeeInOrg(db, caller.org, task.user_id)
}
