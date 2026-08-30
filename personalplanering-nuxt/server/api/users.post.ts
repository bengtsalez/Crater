import bcrypt from 'bcryptjs'
import { pool } from '../utils/db'
import { requireAdmin } from '../utils/auth'
import { apiError } from '../utils/http'

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/i
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const b = await readBody(event)

  const username = String(b?.username ?? '').trim()
  const email = String(b?.email ?? '').trim().toLowerCase()
  const password = String(b?.password ?? '')
  const role = b?.role === 'admin' ? 'admin' : 'member'

  if (!USERNAME_RE.test(username)) throw apiError(400, 'Ogiltigt användarnamn (3–40 tecken: a–z, 0–9, . _ -).')
  if (email && !EMAIL_RE.test(email)) throw apiError(400, 'Ogiltig e-postadress.')
  if (password.length < 8) throw apiError(400, 'Lösenordet måste vara minst 8 tecken.')

  const dup = await pool.query(
    'SELECT 1 FROM users WHERE username = $1 OR (email IS NOT NULL AND lower(email) = $2) LIMIT 1',
    [username, email || null]
  )
  if (dup.rowCount) throw apiError(409, 'Användarnamnet eller e-postadressen är upptagen.')

  const hash = await bcrypt.hash(password, 10)
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, role, org_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, role`,
    [username, email || null, hash, role, admin.org]
  )
  setResponseStatus(event, 201)
  return rows[0]
})
