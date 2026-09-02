import { SESSION_COOKIE, verifySession, signSession, setSessionCookie } from '../utils/auth'
import type { SessionPayload } from '../utils/auth'
import { pool, ensureSchema } from '../utils/db'

const PUBLIC_API_PATHS = new Set(['/api/login', '/api/logout', '/api/signup'])

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? ''

  if (!path.startsWith('/api/')) return

  // Säkerställ att schema-bootstrap + migreringar är klara innan någon query körs.
  await ensureSchema()

  if (PUBLIC_API_PATHS.has(path)) return

  const token = getCookie(event, SESSION_COOKIE)
  let payload = verifySession(token)
  if (!payload) {
    throw createError({ statusCode: 401, data: { error: 'Ej inloggad.' } })
  }

  // Legacy-cookie-backfill: tokens signerade före flerkund-släppet saknar
  // `org`/`role`. Berika från DB och skriv om cookien tyst.
  // TODO: ta bort efter 2026-10-05 (≈35 dagar efter släpp).
  if (payload.org === undefined || payload.role === undefined) {
    const { rows } = await pool.query('SELECT org_id, role FROM users WHERE id = $1', [payload.sub])
    if (!rows[0]) {
      throw createError({ statusCode: 401, data: { error: 'Ej inloggad.' } })
    }
    payload = { ...payload, org: rows[0].org_id, role: rows[0].role } as SessionPayload
    setSessionCookie(event, signSession(payload))
  }

  event.context.user = payload
})
