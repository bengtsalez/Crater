import bcrypt from 'bcryptjs'
import { pool } from '../utils/db'
import { signSession, setSessionCookie } from '../utils/auth'
import { apiError } from '../utils/http'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username?: string; password?: string }>(event)
  const { username, password } = body || {}
  if (!username || !password) {
    throw apiError(400, 'Användarnamn och lösenord krävs.')
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username])
  const user = rows[0]
  const valid = user && (await bcrypt.compare(password, user.password_hash))
  if (!valid) {
    throw apiError(401, 'Fel användarnamn eller lösenord.')
  }

  const token = signSession({
    sub: user.id,
    username: user.username,
    org: user.org_id,
    role: user.role,
  })
  setSessionCookie(event, token)
  return { ok: true }
})
