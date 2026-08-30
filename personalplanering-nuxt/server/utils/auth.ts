import jwt from 'jsonwebtoken'
import type { H3Event } from 'h3'

export const SESSION_COOKIE = 'session'
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 dagar

export type UserRole = 'admin' | 'member'

export interface SessionPayload {
  sub: number
  username: string
  org: number
  role: UserRole
}

function secret(): string {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET saknas i miljövariabler.')
  return s
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: SESSION_MAX_AGE_MS / 1000 })
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null
  try {
    return jwt.verify(token, secret()) as unknown as SessionPayload
  } catch {
    return null
  }
}

export function setSessionCookie(event: H3Event, token: string) {
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_MS / 1000,
    path: '/',
  })
}

export function clearSessionCookie(event: H3Event) {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

// Aktuell användare för en skyddad route. Auth-middlewaren har redan avvisat
// oautentiserade anrop, men detta ger typad åtkomst + en tydlig fallback.
export function requireUser(event: H3Event): SessionPayload {
  const user = event.context.user as SessionPayload | undefined
  if (!user) {
    throw createError({ statusCode: 401, data: { error: 'Ej inloggad.' } })
  }
  return user
}

// Aktuell organisation för en skyddad route. All flerkund-scoping utgår härifrån.
export function requireOrg(event: H3Event): number {
  return requireUser(event).org
}

// Kräver admin-roll (org-ägare). 403 annars.
export function requireAdmin(event: H3Event): SessionPayload {
  const user = requireUser(event)
  if (user.role !== 'admin') {
    throw createError({ statusCode: 403, data: { error: 'Kräver adminbehörighet.' } })
  }
  return user
}
