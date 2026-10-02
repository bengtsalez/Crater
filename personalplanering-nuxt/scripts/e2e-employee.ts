// HTTP-e2e för personalvyn och behörigheterna – mot den BYGGDA servern
// (.output/server/index.mjs) och en riktig Postgres i minnet (PGlite via
// pglite-socket). Rör aldrig .env/prod-DB.
//
//   npm run test:e2e        (bygger först, kör sedan detta skript)
//   node --import tsx scripts/e2e-employee.ts --serve
//                           (startar bara servern mot testdatan för manuell
//                            kontroll; logga in som anna/pm/e2eadmin/revisor, lösenord nedan)
//
// Verifierar uppdragets scenarier 1–8 via riktiga HTTP-anrop med sessionskakor.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import bcrypt from 'bcryptjs'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { BOOTSTRAP_SQL } from '../server/utils/schema'
import { MIGRATIONS } from '../server/migrations'
import { seed } from '../test/seed'

const SERVER_ENTRY = '.output/server/index.mjs'
const PASSWORD = 'e2e-lösenord-123'

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

let failures = 0
let passes = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passes++
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.log(`  ✗ ${name}`, detail ?? '')
  }
}

async function main() {
  if (!existsSync(SERVER_ENTRY)) {
    console.error(`Hittar inte ${SERVER_ENTRY} – kör "npm run build" först (eller "npm run test:e2e").`)
    process.exit(1)
  }

  // ---- Databas: samma schema som appen, förmigrerad så servern bara verifierar ----
  const pg = new PGlite()
  await pg.exec(BOOTSTRAP_SQL)
  await pg.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())')
  for (const m of MIGRATIONS) {
    await pg.exec(m.sql)
    await pg.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version])
  }
  const db = {
    query: async (text: string, params: unknown[] = []) => {
      const r = await pg.query(text, params as any[])
      return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length }
    },
    pg,
    close: () => pg.close(),
  }
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date())
  const s = await seed(db, today)
  const hash = await bcrypt.hash(PASSWORD, 4)
  await db.query('UPDATE users SET password_hash = $1', [hash])
  await db.query("UPDATE organizations SET onboarded_at = now() WHERE onboarded_at IS NULL")
  const admin = (await db.query(
    "INSERT INTO users (org_id, username, password_hash, role) VALUES ($1, 'e2eadmin', $2, 'admin') RETURNING id",
    [s.orgA, hash]
  )).rows[0].id as number
  const member2 = (await db.query(
    "INSERT INTO users (org_id, username, password_hash, role) VALUES ($1, 'member2', $2, 'member') RETURNING id",
    [s.orgA, hash]
  )).rows[0].id as number
  await db.query("INSERT INTO users (org_id, username, password_hash, role) VALUES ($1, 'revisor', $2, 'accountant')", [s.orgA, hash])
  await db.query(
    "INSERT INTO project_line_items (org_id, project_id, type, description, amount, notes) VALUES ($1, $2, 'ata', 'Extra dränering', 1500, 'HEMLIG RADNOTERING')",
    [s.orgA, s.p1]
  )
  const rEva = (await db.query(
    "INSERT INTO resources (org_id, name, type, category) VALUES ($1, 'Eva', 'anstalld', 'mark') RETURNING id",
    [s.orgA]
  )).rows[0].id as number
  await db.query('INSERT INTO assignments (org_id, resource_id, project_id, start_date, end_date) VALUES ($1,$2,$3,$4,$4)', [
    s.orgA, rEva, s.p1, today,
  ])

  const pgPort = await freePort()
  const socket = new PGLiteSocketServer({ db: pg, port: pgPort, host: '127.0.0.1', maxConnections: 20 })
  await socket.start()

  // ---- Server ----
  const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : await freePort()
  const base = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NITRO_PORT: String(port),
      NITRO_HOST: '127.0.0.1',
      DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`,
      DATABASE_SSL: 'false',
      JWT_SECRET: 'e2e-secret-' + Math.random().toString(36).slice(2),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverLog = ''
  server.stdout.on('data', (d) => (serverLog += d))
  server.stderr.on('data', (d) => (serverLog += d))

  const cleanup = async () => {
    server.kill()
    await socket.stop().catch(() => {})
    await pg.close().catch(() => {})
  }

  try {
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(`${base}/api/me`)
        if (r.status === 401) break
      } catch {
        /* startar */
      }
      await new Promise((r) => setTimeout(r, 150))
      if (i === 99) throw new Error('Servern startade inte:\n' + serverLog)
    }

    if (process.argv.includes('--serve')) {
      console.log(`\nTestserver: ${base}  (användare: anna, bo, dora, pm, e2eadmin, revisor – lösenord: ${PASSWORD})`)
      console.log('Ctrl+C för att avsluta.')
      await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()))
      return
    }

    type Res = { status: number; body: any; setCookie: string | null }
    async function call(method: string, path: string, cookie?: string | null, body?: unknown): Promise<Res> {
      const r = await fetch(base + path, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      })
      const text = await r.text()
      let parsed: any = text
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        /* text */
      }
      return { status: r.status, body: parsed, setCookie: r.headers.get('set-cookie') }
    }
    async function login(username: string): Promise<{ cookie: string; role: string }> {
      const r = await call('POST', '/api/login', null, { username, password: PASSWORD })
      if (r.status !== 200 || !r.setCookie) throw new Error(`Inloggning ${username} misslyckades: ${r.status} ${JSON.stringify(r.body)}`)
      return { cookie: r.setCookie.split(';')[0]!, role: r.body.role }
    }

    const anna = await login('anna')
    const bo = await login('bo')
    const carl = await login('carl')
    const dora = await login('dora')
    const pm = await login('pm')
    const adm = await login('e2eadmin')
    const m2 = await login('member2')
    const rev = await login('revisor')

    console.log('\nInloggning och roller')
    check('personal får role=employee vid inloggning', anna.role === 'employee')
    check('interna användare behåller sin roll', pm.role === 'member' && adm.role === 'admin')
    const annaMe = await call('GET', '/api/me', anna.cookie)
    check('/api/me för personal ger resurs och inget onboarding-tillstånd', annaMe.body?.resource?.name === 'Anna' && annaMe.body?.org?.onboarding_state === undefined, annaMe.body)

    console.log('\n1. Två anställda ser bara sina egna bokningar och uppgifter')
    const annaJobs = await call('GET', '/api/employee/jobs', anna.cookie)
    const boJobs = await call('GET', '/api/employee/jobs', bo.cookie)
    check('Anna ser sina två bokningar på P1', annaJobs.status === 200 && annaJobs.body.jobs.map((j: any) => j.assignment_id).join() === [s.aAnnaP1a, s.aAnnaP1b].join(), annaJobs.body)
    check('Bo ser bara sin bokning', boJobs.body.jobs.map((j: any) => j.assignment_id).join() === String(s.aBoP2), boJobs.body)
    const annaP1 = await call('GET', `/api/employee/jobs/${s.p1}`, anna.cookie)
    check('Anna ser bara sin egen uppgift på P1', annaP1.status === 200 && annaP1.body.tasks.map((t: any) => t.id).join() === String(s.tAnnaP1), annaP1.body?.tasks)

    console.log('\n2. Annat arbete via URL eller direkt API-anrop')
    check('Anna → Bos projekt P2 ger inga andras uppgifter', (await call('GET', `/api/employee/jobs/${s.p2}`, anna.cookie)).body?.tasks?.length === 0)
    check('Bo → P1 (ej bokad) ger 404', (await call('GET', `/api/employee/jobs/${s.p1}`, bo.cookie)).status === 404)
    check('Påhittat id ger 404', (await call('GET', '/api/employee/jobs/999999', anna.cookie)).status === 404)
    check('Icke-numeriskt id ger 404', (await call('GET', '/api/employee/jobs/abc', anna.cookie)).status === 404)
    check('Klientens resource_id i query ignoreras', (await call('GET', `/api/employee/jobs?resource_id=${s.rBo}`, anna.cookie)).body.jobs.every((j: any) => j.project_id === s.p1))

    console.log('\n3. Annan organisation')
    check('Anna → org B:s projekt ger 404', (await call('GET', `/api/employee/jobs/${s.p3}`, anna.cookie)).status === 404)
    check('Carl → org A:s projekt ger 404', (await call('GET', `/api/employee/jobs/${s.p1}`, carl.cookie)).status === 404)
    check('Carl kan inte ändra Annas uppgift', (await call('PUT', `/api/employee/tasks/${s.tAnnaP1}`, carl.cookie, { status: 'avslutad' })).status === 404)
    check('PM (org A) når inte org B:s projektuppgifter', ((await call('GET', `/api/projects/${s.p3}/tasks`, pm.cookie)).body ?? []).length === 0)

    console.log('\n4. Interna fält och interna API:er är stängda för personal')
    const internal = [
      ['GET', '/api/projects'], ['GET', `/api/projects/${s.p1}/line-items`], ['GET', `/api/projects/${s.p1}/tasks`],
      ['GET', `/api/projects/${s.p1}/activities`], ['GET', `/api/projects/${s.p1}/staff-info`], ['PUT', `/api/projects/${s.p1}`],
      ['DELETE', `/api/projects/${s.p1}`], ['GET', '/api/customers'], ['GET', `/api/customers/${s.cust}`],
      ['GET', '/api/users'], ['POST', '/api/users'], ['PUT', `/api/users/${s.anna}`], ['GET', '/api/resources'],
      ['GET', '/api/assignments'], ['POST', '/api/assignments'], ['GET', '/api/tasks'], ['PUT', `/api/tasks/${s.tAnnaP1}`],
      ['POST', '/api/tasks'], ['POST', '/api/line-items'], ['GET', '/api/departments'], ['PUT', '/api/org'],
      ['PUT', '/api/onboarding'], ['POST', '/api/onboarding/complete'], ['GET', '/api/projects/next-number'],
      ['GET', '/api/employee/../projects'], ['GET', '/api/employee/%2e%2e/projects'], ['GET', '/API/PROJECTS'],
    ] as const
    const leaks: string[] = []
    for (const [m, p] of internal) {
      const r = await call(m, p, anna.cookie, m === 'GET' || m === 'DELETE' ? undefined : {})
      if (r.status < 400 || (r.status !== 403 && r.status !== 404 && r.status !== 405)) leaks.push(`${m} ${p} → ${r.status}`)
    }
    check(`alla ${internal.length} interna anrop nekas för personal`, leaks.length === 0, leaks)
    const deleted = await db.query('SELECT 1 FROM projects WHERE id = $1', [s.p1])
    check('DELETE-försöket tog inte bort projektet', deleted.rows.length === 1)
    const json = JSON.stringify(annaP1.body)
    const secrets = ['INTERN ANTECKNING', 'HEMLIG KUNDNOTERING', '556000-0000', 'kund@x.se', 'Faktura 1', '999999', 'PM intern']
    check('detaljsvaret saknar interna fält', secrets.every((x) => !json.includes(x)), secrets.filter((x) => json.includes(x)))
    check('kundens kontaktfält finns med', annaP1.body.customer?.phone === '040-1' && annaP1.body.customer?.contact_person === 'Kalle')
    check('konto utan resurskoppling: 403 no_resource', await (async () => {
      const r = await call('GET', '/api/employee/jobs', dora.cookie)
      return r.status === 403 && JSON.stringify(r.body).includes('no_resource')
    })())
    check('interna användare når inte personal-API:t', (await call('GET', '/api/employee/jobs', pm.cookie)).status === 403)

    console.log('\n5. Egen uppgift kan klarmarkeras, andras inte')
    const done = await call('PUT', `/api/employee/tasks/${s.tAnnaP1}`, anna.cookie, { status: 'avslutad' })
    check('Anna klarmarkerar sin uppgift', done.status === 200 && done.body.status === 'avslutad', done.body)
    const pmTasks = await call('GET', `/api/projects/${s.p1}/tasks`, pm.cookie)
    const seen = pmTasks.body.find((t: any) => t.id === s.tAnnaP1)
    check('statusen syns i projektledarens vy', seen?.status === 'avslutad' && seen?.user_role === 'employee', seen)
    const act = await call('GET', `/api/projects/${s.p1}/activities`, pm.cookie)
    check('händelsen loggas i aktivitetsflödet', act.body.some((e: any) => e.event_type === 'task.completed' && e.actor_username === 'anna'))
    check('Anna återöppnar', (await call('PUT', `/api/employee/tasks/${s.tAnnaP1}`, anna.cookie, { status: 'aktiv' })).body.status === 'aktiv')
    check('Anna kan inte ändra Bos uppgift', (await call('PUT', `/api/employee/tasks/${s.tBoP2}`, anna.cookie, { status: 'avslutad' })).status === 404)
    check('Anna kan inte ändra PM:s uppgift', (await call('PUT', `/api/employee/tasks/${s.tPmP1}`, anna.cookie, { status: 'avslutad' })).status === 404)
    check('Anna kan inte ändra titel via personal-API:t', await (async () => {
      await call('PUT', `/api/employee/tasks/${s.tAnnaP1}`, anna.cookie, { status: 'aktiv', title: 'HACK' })
      return (await db.query('SELECT title FROM tasks WHERE id = $1', [s.tAnnaP1])).rows[0].title === 'Anna P1'
    })())
    check('ogiltig status → 400', (await call('PUT', `/api/employee/tasks/${s.tAnnaP1}`, anna.cookie, { status: 'x' })).status === 400)

    console.log('\n7. Projektledarens publicerade instruktioner och uppgifter')
    const draft = await call('PUT', `/api/projects/${s.p1}/staff-info`, pm.cookie, { instructions: 'Ta med:\n- stege\n- <b>borr</b>', published: false })
    check('PM sparar utkast', draft.status === 200 && draft.body.published === false && draft.body.updated_by_username === 'pm', draft.body)
    check('utkast syns inte för personal', (await call('GET', `/api/employee/jobs/${s.p1}`, anna.cookie)).body.staff_info === null)
    await call('PUT', `/api/projects/${s.p1}/staff-info`, pm.cookie, { instructions: 'Ta med:\n- stege\n- <b>borr</b>', published: true })
    const pub = await call('GET', `/api/employee/jobs/${s.p1}`, anna.cookie)
    check('publicerad information syns med uppdaterare', pub.body.staff_info?.instructions?.includes('- stege') && pub.body.staff_info?.updated_by === 'pm', pub.body.staff_info)
    check('Bo (ej bokad på P1) ser den inte', (await call('GET', `/api/employee/jobs/${s.p1}`, bo.cookie)).status === 404)
    const created = await call('POST', '/api/tasks', pm.cookie, { title: 'Mät fönster', notes: 'Alla på plan 2', project_id: s.p1, user_id: s.anna, due_date: today })
    check('PM tilldelar uppgift till personal', created.status === 201 && created.body.user_id === s.anna, created.body)
    const annaAfter = await call('GET', `/api/employee/jobs/${s.p1}`, anna.cookie)
    check('uppgiften syns för Anna med instruktion och deadline', annaAfter.body.tasks.some((t: any) => t.title === 'Mät fönster' && t.notes === 'Alla på plan 2' && t.due_date === today))
    check('PM kan redigera personalens uppgift', (await call('PUT', `/api/tasks/${created.body.id}`, pm.cookie, { title: 'Mät alla fönster' })).body?.title === 'Mät alla fönster')
    check('personaluppgift utan projekt avvisas', (await call('POST', '/api/tasks', pm.cookie, { title: 'x', user_id: s.anna })).status === 400)
    check('uppgift kan inte tilldelas en annan intern användare', (await call('POST', '/api/tasks', pm.cookie, { title: 'x', project_id: s.p1, user_id: member2 })).status === 400)
    check('uppgift kan inte tilldelas personal i annan org', (await call('POST', '/api/tasks', pm.cookie, { title: 'x', project_id: s.p1, user_id: s.carl })).status === 400)
    check('PM kan fortfarande inte ändra en annan intern användares uppgift', (await call('PUT', `/api/tasks/${s.tPmP1}`, m2.cookie, { title: 'x' })).status === 404)
    check('arbetsplatsadress sparas på projektet', (await call('PUT', `/api/projects/${s.p1}`, pm.cookie, { site_address: 'Nya vägen 3, Lund' })).body?.site_address === 'Nya vägen 3, Lund')

    console.log('\nKontoadministration')
    check('member kan inte skapa konton', (await call('POST', '/api/users', pm.cookie, { username: 'x1x', password: PASSWORD })).status === 403)
    const eva = await call('POST', '/api/users', adm.cookie, { username: 'eva', password: PASSWORD, role: 'employee', resource_id: rEva })
    check('admin skapar personalkonto kopplat till resurs', eva.status === 201 && eva.body.resource_id === rEva, eva.body)
    check('samma resurs kan inte kopplas två gånger', (await call('POST', '/api/users', adm.cookie, { username: 'eva2', password: PASSWORD, role: 'employee', resource_id: rEva })).status === 409)
    check('resurs i annan org kan inte kopplas', (await call('POST', '/api/users', adm.cookie, { username: 'eva3', password: PASSWORD, role: 'employee', resource_id: s.rCarl })).status === 400)
    check('personalkonto kräver resurs', (await call('POST', '/api/users', adm.cookie, { username: 'eva4', password: PASSWORD, role: 'employee' })).status === 400)
    const evaLogin = await login('eva')
    check('nytt personalkonto ser sitt arbete idag', (await call('GET', '/api/employee/jobs', evaLogin.cookie)).body.jobs.length === 1)
    check('admin kan inte avaktivera sig själv', (await call('PUT', `/api/users/${admin}`, adm.cookie, { active: false })).status === 400)
    check('admin kan inte ändra användare i annan org', (await call('PUT', `/api/users/${s.carl}`, adm.cookie, { active: false })).status === 404)

    console.log('\n6. Borttagen tilldelning, avaktivering och rollbyte slår igenom direkt')
    await db.query('DELETE FROM assignments WHERE id = $1', [s.aBoP2])
    check('borttagen bokning → Bo når inte P2', (await call('GET', `/api/employee/jobs/${s.p2}`, bo.cookie)).status === 404)
    check('borttagen bokning → Bo kan inte ändra sin uppgift', (await call('PUT', `/api/employee/tasks/${s.tBoP2}`, bo.cookie, { status: 'avslutad' })).status === 404)
    await call('PUT', `/api/users/${s.anna}`, adm.cookie, { active: false })
    check('avaktiverad Anna: gammal cookie → 401', (await call('GET', '/api/employee/jobs', anna.cookie)).status === 401)
    check('avaktiverad Anna kan inte logga in', (await call('POST', '/api/login', null, { username: 'anna', password: PASSWORD })).status === 401)
    await call('PUT', `/api/users/${s.anna}`, adm.cookie, { active: true })
    check('återaktiverad Anna: samma cookie fungerar igen', (await call('GET', '/api/employee/jobs', anna.cookie)).status === 200)
    await call('PUT', `/api/users/${s.anna}`, adm.cookie, { resource_id: null })
    check('borttagen resurskoppling → no_resource', (await call('GET', '/api/employee/jobs', anna.cookie)).status === 403)
    await call('PUT', `/api/users/${s.anna}`, adm.cookie, { resource_id: s.rAnna })
    await call('PUT', `/api/users/${member2}`, adm.cookie, { role: 'employee', resource_id: null })
    check('member → personal: gammal cookie når inte längre interna API:er', (await call('GET', '/api/projects', m2.cookie)).status === 403)

    console.log('\n9. Redovisningskonsult (rollen accountant)')
    check('redovisning får role=accountant vid inloggning', rev.role === 'accountant')
    const revMe = await call('GET', '/api/me', rev.cookie)
    check('/api/me för redovisning saknar onboarding-tillstånd', revMe.status === 200 && revMe.body?.org?.onboarding_state === undefined, revMe.body)
    const revList = await call('GET', '/api/accountant/projects', rev.cookie)
    const revP1 = revList.body?.projects?.find((p: any) => p.id === s.p1)
    check('ser org:ens alla projekt (inte org B:s)', revList.status === 200 && revList.body.projects.map((p: any) => p.id).sort().join() === [s.p1, s.p2].sort().join(), revList.body)
    check('listan har kund, org.nr och ÄTA-summa', revP1?.customer_name === 'Kund AB' && revP1?.customer_organization_number === '556000-0000' && revP1?.ata_total === 1500, revP1)
    const revDetail = await call('GET', `/api/accountant/projects/${s.p1}`, rev.cookie)
    check('detaljvyn har fakturauppgifter och ÄTA-rader', revDetail.status === 200 && revDetail.body.customer?.billing_address === 'Faktura 1' && revDetail.body.customer?.email === 'kund@x.se' && revDetail.body.line_items?.length === 1, revDetail.body)
    const revJson = JSON.stringify([revList.body, revDetail.body])
    check('inga interna anteckningar läcker', !/INTERN ANTECKNING|HEMLIG/.test(revJson))
    check('org B:s projekt ger 404', (await call('GET', `/api/accountant/projects/${s.p3}`, rev.cookie)).status === 404)
    const revDenied = [
      ['GET', '/api/projects'], ['GET', `/api/projects/${s.p1}/line-items`], ['PUT', `/api/projects/${s.p1}`],
      ['DELETE', `/api/projects/${s.p1}`], ['GET', '/api/customers'], ['PUT', `/api/customers/${s.cust}`],
      ['GET', '/api/users'], ['POST', '/api/users'], ['GET', '/api/assignments'], ['GET', '/api/tasks'],
      ['POST', '/api/line-items'], ['PUT', '/api/org'], ['GET', '/api/employee/jobs'],
      ['GET', '/api/accountant/../projects'], ['GET', '/api/accountant/%2e%2e/customers'],
    ] as const
    const revLeaks: string[] = []
    for (const [m, p] of revDenied) {
      const r = await call(m, p, rev.cookie, m === 'GET' || m === 'DELETE' ? undefined : {})
      if (r.status !== 403 && r.status !== 404 && r.status !== 405) revLeaks.push(`${m} ${p} → ${r.status}`)
    }
    check(`alla ${revDenied.length} interna/skrivande anrop nekas för redovisning`, revLeaks.length === 0, revLeaks)
    check('interna användare och personal når inte redovisnings-API:t', (await call('GET', '/api/accountant/projects', pm.cookie)).status === 403 && (await call('GET', '/api/accountant/projects', bo.cookie)).status === 403)
    check('redovisningskonto kan inte bli projektledare', (await call('PUT', `/api/projects/${s.p2}`, pm.cookie, { project_manager_user_id: revMe.body.id })).status === 400)
    const acc2 = await call('POST', '/api/users', adm.cookie, { username: 'revisor2', password: PASSWORD, role: 'accountant' })
    check('admin skapar redovisningskonto', acc2.status === 201 && acc2.body.role === 'accountant' && acc2.body.resource_id === null, acc2.body)

    console.log('\n8. Befintlig intern planering och befintliga roller')
    const projects = await call('GET', '/api/projects', pm.cookie)
    check('member listar projekt', projects.status === 200 && projects.body.length === 2, projects.status)
    check('member listar bokningar', (await call('GET', '/api/assignments', pm.cookie)).body.length >= 3)
    check('member listar kunder, resurser, avdelningar, användare', (await Promise.all(['/api/customers', '/api/resources', '/api/departments', '/api/users'].map((p) => call('GET', p, pm.cookie)))).every((r) => r.status === 200))
    const newBooking = await call('POST', '/api/assignments', pm.cookie, { resource_id: s.rBo, project_id: s.p1, start_date: today, end_date: today })
    check('member skapar bokning', newBooking.status === 201)
    check('…och den syns direkt för Bo', (await call('GET', `/api/employee/jobs/${s.p1}`, bo.cookie)).status === 200)
    check('member skapar och ändrar egen uppgift', await (async () => {
      const t = await call('POST', '/api/tasks', pm.cookie, { title: 'Egen' })
      const u = await call('PUT', `/api/tasks/${t.body.id}`, pm.cookie, { status: 'avslutad' })
      return t.status === 201 && t.body.user_id === s.pm && u.body.status === 'avslutad'
    })())
    check('admin når admin-endpoints', (await call('PUT', '/api/org', adm.cookie, { app_title: 'Byggproffs' })).status === 200)
    check('member når inte admin-endpoints', (await call('PUT', '/api/org', pm.cookie, { app_title: 'x' })).status === 403)
    check('utloggning rensar kakan', ((await call('POST', '/api/logout', pm.cookie)).setCookie ?? '').includes('session=;'))
  } finally {
    await cleanup()
  }

  console.log(`\n${passes} godkända, ${failures} misslyckade`)
  if (failures) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
