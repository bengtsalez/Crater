import type { UserRole } from '../types'

// Varje begränsad roll har sin egen vy och sin egen inloggningssida.
// Behörigheten avgörs alltid av servern – det här styr bara navigeringen.
export type LoginPath = '/login' | '/personal/login' | '/redovisning/login'

export function homePathForRole(role: UserRole | string | undefined): string {
  if (role === 'employee') return '/personal'
  if (role === 'accountant') return '/redovisning'
  return '/'
}

const isUnder = (path: string, base: string) => path === base || path.startsWith(base + '/')

export function isPersonalPath(path: string): boolean {
  return isUnder(path, '/personal')
}

export function isAccountantPath(path: string): boolean {
  return isUnder(path, '/redovisning')
}

// Inloggningssidan som hör till vyn man befinner sig i.
export function loginPathFor(path: string): LoginPath {
  if (isPersonalPath(path)) return '/personal/login'
  if (isAccountantPath(path)) return '/redovisning/login'
  return '/login'
}
