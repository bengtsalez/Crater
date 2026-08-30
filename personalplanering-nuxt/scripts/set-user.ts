import bcrypt from 'bcryptjs'
import { pool, ready } from '../server/utils/db'

async function main() {
  const [username, password] = process.argv.slice(2)
  if (!username || !password) {
    console.error('Användning: npm run set-user -- <användarnamn> <lösenord>')
    process.exitCode = 1
    return
  }

  await ready
  const password_hash = await bcrypt.hash(password, 10)
  await pool.query(
    `INSERT INTO users (username, password_hash) VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [username, password_hash]
  )
  console.log(`Användare "${username}" sparad.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
