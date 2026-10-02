import { SESSION_COOKIE, verifySession, clearSessionCookie } from '../utils/auth'
import type { SessionPayload, UserRole } from '../utils/auth'
import { pool, ensureSchema } from '../utils/db'
import { isAccountantAllowedPath, isEmployeeAllowedPath, loadSessionUser } from '../utils/employeeAccess'

const PUBLIC_API_PATHS = new Set(['/api/login', '/api/logout', '/api/signup'])

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? ''

  // Skiftlägesokänsligt: allt som ser ut som /api/** kräver inloggning, även
  // varianter som routern inte själv matchar (defense-in-depth).
  if (!path.toLowerCase().startsWith('/api/')) return

  // Säkerställ att schema-bootstrap + migreringar är klara innan någon query körs.
  await ensureSchema()

  if (PUBLIC_API_PATHS.has(path)) return

  const token = getCookie(event, SESSION_COOKIE)
  const claims = verifySession(token)
  if (!claims) {
    throw createError({ statusCode: 401, data: { error: 'Ej inloggad.' } })
  }

  // JWT:n bevisar bara VEM som är inloggad. Roll, org, aktiv-status och
  // resurskoppling läses från DB på varje anrop, så att avaktivering,
  // rollbyte och ändrad koppling slår igenom direkt – även om en äldre token
  // fortfarande är giltig. (Ersätter även den gamla legacy-backfillen för
  // tokens utan org/role.)
  const row = await loadSessionUser(pool, claims.sub)
  if (!row || !row.active || (claims.org !== undefined && Number(claims.org) !== row.org_id)) {
    clearSessionCookie(event)
    throw createError({ statusCode: 401, data: { error: 'Ej inloggad.' } })
  }

  const payload: SessionPayload = {
    sub: row.id,
    username: row.username,
    org: row.org_id,
    role: row.role as UserRole,
    resourceId: row.role === 'employee' ? row.resource_id : null,
  }

  // Personalkonton: deny-by-default. Bara /api/me, /api/logout och
  // /api/employee/** – alla interna API:er (projekt, kunder, ekonomi,
  // användare, org-inställningar …) är stängda oavsett route-implementation.
  if (payload.role === 'employee' && !isEmployeeAllowedPath(event.path)) {
    throw createError({ statusCode: 403, data: { error: 'Saknar behörighet.' } })
  }

  // Redovisningskonsult: samma deny-by-default, men bara skrivskyddade
  // /api/accountant/**.
  if (payload.role === 'accountant' && !isAccountantAllowedPath(event.path)) {
    throw createError({ statusCode: 403, data: { error: 'Saknar behörighet.' } })
  }

  event.context.user = payload
})
