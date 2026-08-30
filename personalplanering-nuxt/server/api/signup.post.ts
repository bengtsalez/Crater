import bcrypt from 'bcryptjs'
import { pool } from '../utils/db'
import { signSession, setSessionCookie } from '../utils/auth'
import { slugifyKey } from '../utils/departments'
import { hitRateLimit } from '../utils/rateLimit'
import { apiError } from '../utils/http'

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/i
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export default defineEventHandler(async (event) => {
  const b = await readBody(event)

  // Honeypot – ifyllt fält = bot.
  if (b?.website) throw apiError(400, 'Ogiltig begäran.')

  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!hitRateLimit('signup', ip, 5, 60 * 60 * 1000)) {
    throw apiError(429, 'För många försök. Försök igen senare.')
  }

  const company = String(b?.company_name ?? '').trim()
  const username = String(b?.admin_username ?? '').trim()
  const email = String(b?.admin_email ?? '').trim().toLowerCase()
  const password = String(b?.password ?? '')

  if (company.length < 2 || company.length > 80) throw apiError(400, 'Ogiltigt företagsnamn.')
  if (!USERNAME_RE.test(username)) throw apiError(400, 'Ogiltigt användarnamn (3–40 tecken: a–z, 0–9, . _ -).')
  if (!EMAIL_RE.test(email)) throw apiError(400, 'Ogiltig e-postadress.')
  if (password.length < 8) throw apiError(400, 'Lösenordet måste vara minst 8 tecken.')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const dup = await client.query(
      'SELECT 1 FROM users WHERE username = $1 OR lower(email) = $2 LIMIT 1',
      [username, email]
    )
    if (dup.rowCount) throw apiError(409, 'Användarnamnet eller e-postadressen är upptagen.')

    const base = slugifyKey(company) || 'org'
    let slug = base
    for (let i = 0; i < 10; i++) {
      const taken = await client.query('SELECT 1 FROM organizations WHERE slug = $1', [slug])
      if (!taken.rowCount) break
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
    }

    const org = await client.query(
      'INSERT INTO organizations (name, slug, app_title) VALUES ($1, $2, $1) RETURNING id',
      [company, slug]
    )
    const orgId = org.rows[0].id

    const hash = await bcrypt.hash(password, 10)
    const user = await client.query(
      `INSERT INTO users (username, email, password_hash, role, org_id)
       VALUES ($1, $2, $3, 'admin', $4) RETURNING id`,
      [username, email, hash, orgId]
    )

    await client.query(
      `INSERT INTO departments (org_id, key, label, sort_order) VALUES
        ($1, 'mark', 'Mark', 0),
        ($1, 'fasad', 'Fasad', 1),
        ($1, 'te', 'TE', 2)`,
      [orgId]
    )

    await client.query('COMMIT')

    const token = signSession({ sub: user.rows[0].id, username, org: orgId, role: 'admin' })
    setSessionCookie(event, token)
    setResponseStatus(event, 201)
    return { ok: true, onboarding: true }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})
