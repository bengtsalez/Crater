import jwt from 'jsonwebtoken'
import type { H3Event } from 'h3'
import { pool } from './db'
import { findEmployeeResource } from './employeeAccess'

export const SESSION_COOKIE = 'session'
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 dagar

// 'employee' = personalkonto (fältpersonal). Ser bara /personal-vyn och får
// bara anropa /api/me, /api/logout och /api/employee/** (se server/middleware/auth.ts).
// 'accountant' = redovisningskonsult. Ser bara /redovisning (projekt + kunder,
// skrivskyddat) och får bara anropa /api/me, /api/logout och /api/accountant/**.
export type UserRole = 'admin' | 'member' | 'employee' | 'accountant'

export interface SessionPayload {
  sub: number
  username: string
  org: number
  role: UserRole
  // Kopplad personalresurs (users.resource_id). Sätts av auth-middlewaren från
  // DB på varje request – JWT:ns värde används aldrig för behörighet.
  resourceId?: number | null
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
    // Secure i allt utom lokal dev. Förlita dig inte på NODE_ENV – Netlifys
    // funktionsruntime sätter det inte alltid, och då hade kakan tappat Secure.
    secure: !import.meta.dev,
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

// Intern användare (admin/member) – allt utom personal- och redovisningskonton. Middlewaren
// stoppar redan personal från interna endpoints; detta är defense-in-depth
// så att en route som av misstag hamnar utanför middlewarens skydd ändå är stängd.
export function requireInternal(event: H3Event): SessionPayload {
  const user = requireUser(event)
  if (user.role === 'employee' || user.role === 'accountant') {
    throw createError({ statusCode: 403, data: { error: 'Saknar behörighet.' } })
  }
  return user
}

// Redovisningskonsult – skrivskyddad åtkomst till org:ens projekt och kunder.
export function requireAccountant(event: H3Event): SessionPayload {
  const user = requireUser(event)
  if (user.role !== 'accountant') {
    throw createError({ statusCode: 403, data: { error: 'Endast för redovisningskonton.' } })
  }
  return user
}

// Aktuell organisation för en skyddad (intern) route. All flerkund-scoping utgår härifrån.
export function requireOrg(event: H3Event): number {
  return requireInternal(event).org
}

export interface EmployeeContext {
  userId: number
  org: number
  resourceId: number
  username: string
}

// Personalkonto med giltig resurskoppling. `resourceId` kommer från DB via
// middlewaren; här verifieras dessutom att resursen finns i samma org.
// Utan koppling: 403 med code 'no_resource' så klienten kan visa ett tydligt besked.
export async function requireEmployee(event: H3Event): Promise<EmployeeContext> {
  const user = requireUser(event)
  if (user.role !== 'employee') {
    throw createError({ statusCode: 403, data: { error: 'Endast för personalkonton.' } })
  }
  const resource = user.resourceId ? await findEmployeeResource(pool, user.org, user.resourceId) : null
  if (!resource) {
    throw createError({
      statusCode: 403,
      data: {
        error: 'Ditt konto är inte kopplat till någon personalresurs. Kontakta din arbetsledare.',
        code: 'no_resource',
      },
    })
  }
  return { userId: user.sub, org: user.org, resourceId: resource.id, username: user.username }
}

// Kräver admin-roll (org-ägare). 403 annars.
export function requireAdmin(event: H3Event): SessionPayload {
  const user = requireUser(event)
  if (user.role !== 'admin') {
    throw createError({ statusCode: 403, data: { error: 'Kräver adminbehörighet.' } })
  }
  return user
}
