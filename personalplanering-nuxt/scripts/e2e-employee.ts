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
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
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
  await db.query("INSERT INTO users (org_id, username, password_hash, role) VALUES ($1, 'bchef', $2, 'admin')", [s.orgB, hash])
  await db.query("INSERT INTO users (org_id, username, password_hash, role) VALUES ($1, 'kontor', $2, 'member')", [s.orgA, hash])
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

  // ---- Fejkad S3-kompatibel lagring (path-style) för bilder i egenkontroller ----
  // Kontrollerar att anropen är signerade och att PUT skickar den signerade
  // Content-Type – riktig R2/S3 testas inte här (se docs/inspections.md).
  const s3Objects = new Map<string, { body: Buffer; type: string }>()
  const s3Log: string[] = []
  const s3 = createHttpServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,HEAD,DELETE', 'Access-Control-Allow-Headers': '*' }
    if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end()
    const url = new URL(req.url ?? '/', 'http://s3')
    const signed = url.searchParams.has('X-Amz-Signature') || String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256')
    const key = decodeURIComponent(url.pathname.replace(/^\/e2e-bucket\//, ''))
    s3Log.push(`${req.method} ${key}`)
    if (!signed || !url.pathname.startsWith('/e2e-bucket/')) return void res.writeHead(403, cors).end('unsigned')
    if (req.method === 'PUT') {
      const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders') ?? ''
      if (!signedHeaders.includes('content-type')) return void res.writeHead(403, cors).end('content-type not signed')
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        s3Objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers['content-type'] ?? '') })
        res.writeHead(200, cors).end()
      })
      return
    }
    const obj = s3Objects.get(key)
    if (req.method === 'DELETE') {
      s3Objects.delete(key)
      return void res.writeHead(204, cors).end()
    }
    if (!obj) return void res.writeHead(404, cors).end()
    if (req.method === 'HEAD') return void res.writeHead(200, { ...cors, 'content-length': obj.body.length, 'content-type': obj.type }).end()
    const range = /bytes=(\d+)-(\d+)/.exec(String(req.headers.range ?? ''))
    const body = range ? obj.body.subarray(Number(range[1]), Number(range[2]) + 1) : obj.body
    res.writeHead(range ? 206 : 200, { ...cors, 'content-type': obj.type, 'content-length': body.length }).end(body)
  })
  const s3Port = await freePort()
  await new Promise<void>((r) => s3.listen(s3Port, '127.0.0.1', () => r()))

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
      BILLING_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      INSPECTION_S3_ENDPOINT: `http://127.0.0.1:${s3Port}`,
      INSPECTION_S3_BUCKET: 'e2e-bucket',
      INSPECTION_S3_REGION: 'us-east-1',
      INSPECTION_S3_ACCESS_KEY_ID: 'e2e-access',
      INSPECTION_S3_SECRET_ACCESS_KEY: 'e2e-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverLog = ''
  server.stdout.on('data', (d) => (serverLog += d))
  server.stderr.on('data', (d) => (serverLog += d))

  const cleanup = async () => {
    server.kill()
    s3.close()
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

    console.log('\n11. Egenkontroller & checklistor (mall → etapper → personal → granskning → PDF)')
    {
      const jpeg = (() => {
        const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
        return Buffer.from([0xff, 0xd8, ...sof, 0xff, 0xd9])
      })()
      const content = {
        name: 'Dränering E2E',
        kind: 'self_inspection',
        sections: [
          { title: 'Före start', items: [{ key: 'a', title: 'Ledningar utsatta', answer_type: 'result', critical: true }] },
          { title: 'Montering', items: [
            { key: 'b', title: 'Foto av ledning', answer_type: 'result', min_photos: 1 },
            { key: 'c', title: 'Schaktdjup', answer_type: 'number', unit: 'm' },
          ] },
        ],
      }
      check('member får inte skapa mallar', (await call('POST', '/api/inspection-templates', pm.cookie, content)).status === 403)
      const tpl = await call('POST', '/api/inspection-templates', adm.cookie, content)
      check('admin skapar mall (utkast)', tpl.status === 201 && tpl.body.has_draft && tpl.body.latest_version === 0, tpl.body)
      const pub = await call('POST', `/api/inspection-templates/${tpl.body.id}/publish`, adm.cookie, { draft_rev: tpl.body.draft_rev })
      check('admin publicerar version 1', pub.status === 200 && pub.body.latest_version === 1, pub.body)
      const ex1 = await call('POST', '/api/inspection-templates/examples', adm.cookie)
      const ex2 = await call('POST', '/api/inspection-templates/examples', adm.cookie)
      check('exempelmallar läggs till en gång (idempotent)', ex1.body?.added === 4 && ex2.body?.added === 0, [ex1.body, ex2.body])
      const tplList = await call('GET', '/api/inspection-templates', pm.cookie)
      check('member ser publicerade mallar', tplList.status === 200 && tplList.body.some((t: any) => t.id === tpl.body.id))

      const empty = await call('GET', `/api/projects/${s.p2}/inspections`, pm.cookie)
      check('projekt utan kontroller: tillstånd "none"', empty.status === 200 && empty.body.summary.state === 'none', empty.body)
      const created = await call('POST', `/api/projects/${s.p1}/inspections`, pm.cookie, {
        inspections: [
          { template_id: tpl.body.id, location: 'Norrsida', responsible_user_id: s.anna, due_date: today },
          { template_id: tpl.body.id, location: 'Södersida', responsible_user_id: s.anna },
        ],
      })
      check('projektledare lägger till två etapper från samma mall', created.status === 201 && created.body.ids.length === 2 && created.body.summary.state === 'unanswered', created.body)
      const [north, south] = created.body.ids as number[]

      const annaList = await call('GET', '/api/employee/inspections', anna.cookie)
      check('Anna ser sina två tilldelade kontroller', annaList.status === 200 && annaList.body.length === 2, annaList.body)
      check('Bo ser inga kontroller', (await call('GET', '/api/employee/inspections', bo.cookie)).body?.length === 0)
      check('Bo når inte Annas kontroll via id', (await call('GET', `/api/employee/inspections/${north}`, bo.cookie)).status === 404)
      const bchef0 = await login('bchef')
      check('annan org når inte kontrollen, PDF eller protokoll', (await Promise.all([
        call('GET', `/api/inspections/${north}`, bchef0.cookie),
        call('GET', `/api/inspections/${north}/pdf`, bchef0.cookie),
        call('GET', `/api/projects/${s.p1}/inspections/protocol`, bchef0.cookie),
      ])).every((r) => r.status === 404))
      check('redovisning och personal nekas interna kontroll-API:er', (await Promise.all([
        call('GET', '/api/inspections', rev.cookie),
        call('GET', '/api/employee/inspections', rev.cookie),
        call('GET', `/api/inspections/${north}`, anna.cookie),
        call('POST', `/api/inspections/${north}/transition`, anna.cookie, { action: 'approve' }),
      ])).every((r) => r.status === 403), 'någon släpptes igenom')

      let v = (await call('GET', `/api/employee/inspections/${north}`, anna.cookie)).body
      const item = (k: string) => v.items.find((i: any) => i.item_key === k)
      check('personalens vy har lagring konfigurerad och obesvarade punkter', v.storage_configured === true && v.items.every((i: any) => i.answer === null), v)
      let r = await call('PUT', `/api/employee/inspections/${north}/answers/${item('a').id}`, anna.cookie, { result: 'ok', rev: 0 })
      check('Anna sparar ett svar', r.status === 200 && r.body.status === 'in_progress', r.body)
      const stale2 = await call('PUT', `/api/inspections/${north}/answers/${item('a').id}`, pm.cookie, { result: 'deviation', comment: 'x', rev: 0 })
      check('projektledarens äldre formulär skriver inte över (409 conflict)', stale2.status === 409 && stale2.body?.data?.code === 'conflict', stale2.body)
      v = r.body

      // Bild: direktuppladdning till lagringen med signerad URL.
      const badType = await call('POST', `/api/employee/inspections/${north}/attachments`, anna.cookie, { item_id: item('b').id, content_type: 'image/heic', byte_size: 100 })
      check('fel filformat ger begripligt fel', badType.status === 400 && /JPEG/.test(badType.body?.data?.error ?? ''), badType.body)
      const up = await call('POST', `/api/employee/inspections/${north}/attachments`, anna.cookie, { item_id: item('b').id, content_type: 'image/jpeg', byte_size: jpeg.length })
      check('uppladdning ger signerad PUT-URL mot lagringen', up.status === 201 && up.body.upload_url.startsWith(`http://127.0.0.1:${s3Port}/e2e-bucket/org/`), up.body)
      const put = await fetch(up.body.upload_url, { method: 'PUT', headers: up.body.headers, body: jpeg })
      check('klienten laddar upp direkt till lagringen', put.status === 200)
      const beforeConfirm = (await call('GET', `/api/employee/inspections/${north}`, anna.cookie)).body
      check('obekräftad bild räknas inte', beforeConfirm.items.find((i: any) => i.item_key === 'b').photos.length === 0)
      r = await call('POST', `/api/employee/inspections/${north}/attachments/${up.body.id}/confirm`, anna.cookie)
      check('bekräftad bild syns på punkten', r.status === 200 && r.body.items.find((i: any) => i.item_key === 'b').photos.length === 1, r.body)
      v = r.body
      const img = await call('GET', `/api/employee/inspections/${north}/attachments/${up.body.id}`, anna.cookie)
      const imgRes = await fetch(base + `/api/employee/inspections/${north}/attachments/${up.body.id}`, { headers: { cookie: anna.cookie }, redirect: 'manual' })
      const location = imgRes.headers.get('location') ?? ''
      const fetched = location ? Buffer.from(await (await fetch(location)).arrayBuffer()) : Buffer.alloc(0)
      check('bild hämtas via kortlivad signerad adress efter behörighetskontroll', img.status === 302 && /X-Amz-Expires=60/.test(location) && fetched.equals(jpeg), location)
      check('Bo och annan org får inte bilden', (await call('GET', `/api/employee/inspections/${north}/attachments/${up.body.id}`, bo.cookie)).status === 404 && (await call('GET', `/api/inspections/${north}/attachments/${up.body.id}`, bchef0.cookie)).status === 404)
      const fake = await call('POST', `/api/employee/inspections/${north}/attachments`, anna.cookie, { item_id: item('b').id, content_type: 'image/jpeg', byte_size: 20 })
      await fetch(fake.body.upload_url, { method: 'PUT', headers: fake.body.headers, body: Buffer.from('%PDF-1.7 ingen bild') })
      const fakeConfirm = await call('POST', `/api/employee/inspections/${north}/attachments/${fake.body.id}/confirm`, anna.cookie)
      check('fil som inte är en bild avvisas och raderas', fakeConfirm.status === 400 && /giltig/.test(fakeConfirm.body?.data?.error ?? '') && ![...s3Objects.keys()].some((k) => k.endsWith(fake.body.id)), fakeConfirm.body)

      const incomplete = await call('POST', `/api/employee/inspections/${north}/submit`, anna.cookie)
      check('inlämning nekas med ofullständiga svar', incomplete.status === 400 && incomplete.body?.data?.code === 'incomplete', incomplete.body)
      await call('PUT', `/api/employee/inspections/${north}/answers/${item('b').id}`, anna.cookie, { result: 'ok', rev: item('b').rev })
      r = await call('PUT', `/api/employee/inspections/${north}/answers/${item('c').id}`, anna.cookie, { number_value: '1,2', rev: item('c').rev })
      v = r.body
      r = await call('PUT', `/api/employee/inspections/${north}/answers/${item('a').id}`, anna.cookie, { result: 'deviation', comment: 'Fjärrvärmeledning i schaktet', rev: item('a').rev })
      check('Anna rapporterar avvikelse', r.status === 200 && r.body.deviations.length === 1 && r.body.deviations[0].status === 'open', r.body)
      v = r.body
      const sub = await call('POST', `/api/employee/inspections/${north}/submit`, anna.cookie)
      check('inlämning tillåts med öppen avvikelse', sub.status === 200 && sub.body.status === 'submitted', sub.body)
      check('dubbel inlämning → 409', (await call('POST', `/api/employee/inspections/${north}/submit`, anna.cookie)).status === 409)
      check('Anna kan inte ändra inlämnade svar', (await call('PUT', `/api/employee/inspections/${north}/answers/${item('c').id}`, anna.cookie, { number_value: '9', rev: 1 })).status === 409)

      check('komplettering kräver kommentar', (await call('POST', `/api/inspections/${north}/transition`, pm.cookie, { action: 'request_changes' })).status === 400)
      r = await call('POST', `/api/inspections/${north}/transition`, pm.cookie, { action: 'request_changes', comment: 'Ange åtgärd för avvikelsen' })
      check('projektledaren begär komplettering', r.status === 200 && r.body.status === 'changes_requested', r.body)
      const dev = r.body.deviations[0]
      r = await call('POST', `/api/employee/inspections/${north}/deviations/${dev.id}/resolve`, anna.cookie, { action_description: 'Schaktet flyttat 0,5 m', rev: dev.rev })
      check('Anna dokumenterar åtgärd', r.status === 200 && r.body.deviations[0].status === 'resolved', r.body)
      check('personal kan inte verifiera', (await call('POST', `/api/inspections/${north}/deviations/${dev.id}/verify`, anna.cookie)).status === 403)
      await call('POST', `/api/employee/inspections/${north}/submit`, anna.cookie)
      const blocked = await call('POST', `/api/inspections/${north}/transition`, pm.cookie, { action: 'approve' })
      check('godkännande blockeras av ej verifierad avvikelse', blocked.status === 409 && blocked.body?.data?.code === 'open_deviations', blocked.body)
      r = await call('POST', `/api/inspections/${north}/deviations/${dev.id}/verify`, pm.cookie)
      check('projektledaren verifierar åtgärden', r.status === 200 && r.body.deviations[0].status === 'verified', r.body)
      r = await call('POST', `/api/inspections/${north}/transition`, pm.cookie, { action: 'approve', comment: 'Godkänd' })
      check('kontrollen godkänns och låses', r.status === 200 && r.body.status === 'approved' && r.body.approved_by_name === 'pm', r.body)

      const pdf = await fetch(base + `/api/inspections/${north}/pdf`, { headers: { cookie: pm.cookie } })
      const pdfBytes = Buffer.from(await pdf.arrayBuffer())
      check('PDF exporteras', pdf.status === 200 && pdf.headers.get('content-type') === 'application/pdf' && pdfBytes.subarray(0, 5).toString() === '%PDF-' && /rev1\.pdf/.test(pdf.headers.get('content-disposition') ?? ''))
      check('Anna kan ladda ner sin kontroll som PDF', (await fetch(base + `/api/employee/inspections/${north}/pdf`, { headers: { cookie: anna.cookie } })).status === 200)
      const proto = await fetch(base + `/api/projects/${s.p1}/inspections/protocol`, { headers: { cookie: pm.cookie } })
      check('slutprotokoll märks ofullständigt när Södersida återstår', proto.status === 200 && /ofullstandigt/.test(proto.headers.get('content-disposition') ?? ''))

      // Södersida: ej tillämplig ersätter foto/mätkrav; samtidig dubbelinlämning ger en inlämning.
      let sv = (await call('GET', `/api/employee/inspections/${south}`, anna.cookie)).body
      for (const [k, val] of [['a', { result: 'ok' }], ['b', { result: 'na', na_reason: 'Ingen ledning på södersidan' }], ['c', { result: 'na', na_reason: 'Mäts ej' }]] as const) {
        const it = sv.items.find((i: any) => i.item_key === k)
        sv = (await call('PUT', `/api/employee/inspections/${south}/answers/${it.id}`, anna.cookie, { ...val, rev: it.rev })).body
      }
      const both = await Promise.all([
        call('POST', `/api/employee/inspections/${south}/submit`, anna.cookie),
        call('POST', `/api/employee/inspections/${south}/submit`, anna.cookie),
      ])
      check('samtidig dubbelinlämning: en lyckas, en 409', both.map((x) => x.status).sort().join() === '200,409', both.map((x) => x.status))
      const events = (await db.query("SELECT count(*)::int AS n FROM inspection_events WHERE inspection_id = $1 AND event_type = 'submitted'", [south])).rows[0].n
      check('…och bara en inlämningshändelse', events === 1, events)

      const revn = await call('POST', `/api/inspections/${north}/revision`, pm.cookie, { reason: 'Fel mätvärde' })
      check('ny revision av godkänd kontroll', revn.status === 201 && revn.body.revision === 2 && revn.body.previous_inspection_id === north, revn.body)
      const old = await call('GET', `/api/inspections/${north}`, pm.cookie)
      check('tidigare godkänd revision är orörd', old.body.status === 'approved' && old.body.superseded_by_id === revn.body.id)
      const oldPdf = await fetch(base + `/api/inspections/${north}/pdf`, { headers: { cookie: pm.cookie } })
      check('tidigare godkänd PDF kan fortfarande hämtas', oldPdf.status === 200 && /rev1\.pdf/.test(oldPdf.headers.get('content-disposition') ?? ''))
      check('personal ser bara den aktuella revisionen', (await call('GET', `/api/employee/inspections/${north}`, anna.cookie)).status === 404)
      const devList = await call('GET', `/api/inspection-deviations?project_id=${s.p1}&status=verified`, pm.cookie)
      check('samlad avvikelselista med filter', devList.status === 200 && devList.body.length === 1, devList.body)
      const acts = await call('GET', `/api/projects/${s.p1}/activities`, pm.cookie)
      const types = new Set((acts.body ?? []).map((a: any) => a.event_type))
      check('aktivitetsflödet visar kontrollhändelser', ['inspection.created', 'inspection.submitted', 'inspection.changes_requested', 'inspection.approved', 'inspection.revised', 'deviation.reported', 'deviation.resolved', 'deviation.verified'].every((t) => types.has(t)), [...types])
    }

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

    console.log('\n10. Fakturering (admin/member i alla projekt; personal, redovisning och andra org nekas)')
    const bchef = await login('bchef')
    const kontor = await login('kontor')
    // 'kontor' (member) är inte projektledare för P1 men ska ändå kunna hantera faktureringen.
    const bv = await call('GET', `/api/projects/${s.p1}/billing`, kontor.cookie)
    check('member (ej projektets PL) läser faktureringen', bv.status === 200 && bv.body.project?.id === s.p1, bv.status)
    check('admin läser faktureringen', (await call('GET', `/api/projects/${s.p1}/billing`, adm.cookie)).status === 200)
    const bs = await call('PUT', `/api/projects/${s.p1}/billing`, kontor.cookie, { rot_enabled: true })
    check('member sparar ROT-inställning', bs.status === 200 && bs.body.settings.rot_enabled === true, bs.body)
    const bl = await call('PUT', `/api/projects/${s.p1}/billing/lines`, pm.cookie, {
      lines: [
        { description: 'Arbete', line_type: 'arbete', quantity: '1', unit: 'st', unit_price_ex_vat: '80000', rot_eligible: true },
        { description: 'Material', line_type: 'material', quantity: '1', unit: 'st', unit_price_ex_vat: '80000' },
      ],
    })
    check('totalsumman räknas fram ur posterna (200 000 kr)', bl.status === 200 && bl.body.settings.base_total_inc_ore === 20000000, bl.body?.settings)
    const plan = await call('PUT', `/api/projects/${s.p1}/billing/installments`, pm.cookie, {
      installments: [{ name: 'Del 1', percent: '30' }, { name: 'Del 2', percent: '40' }, { name: 'Del 3', percent: '30' }],
    })
    const parts = (plan.body?.parts ?? []) as any[]
    check('plan 30/40/30 ger 60 000 / 80 000 / 60 000 och max-ROT 9 000 / 12 000 / 9 000', plan.status === 200 &&
      parts.map((p) => plan.body.calc.parts[p.id].amounts.inc_ore).join() === '6000000,8000000,6000000' &&
      parts.map((p) => plan.body.calc.parts[p.id].max_rot_ore).join() === '900000,1200000,900000', plan.body?.calc?.parts)
    const part1 = parts[0]?.id
    const up = await call('PUT', `/api/billing/parts/${part1}`, pm.cookie, {
      rot_recipients: [{ position: 1, name: 'Åsa Öberg', personnummer: '811218-9876', amount: '9000' }],
    })
    check('manuellt ROT ger att betala 51 000', up.status === 200 && up.body.calc.parts[part1].to_pay_ore === 5100000, up.body?.calc?.parts?.[part1])
    check('vyn innehåller aldrig fullständigt personnummer', !/811218|198112/.test(JSON.stringify(up.body)))
    const plain = await call('GET', `/api/billing/parts/${part1}`, pm.cookie)
    check('redigeringsendpoint ger personnummer till behörig', plain.status === 200 && plain.body.rot_recipients[0].personnummer === '198112189876')
    const pdf = await fetch(`${base}/api/billing/parts/${part1}/pdf`, { headers: { cookie: pm.cookie } })
    const pdfBytes = Buffer.from(await pdf.arrayBuffer())
    check('PDF-utkast genereras', pdf.status === 200 && pdf.headers.get('content-type') === 'application/pdf' && pdfBytes.subarray(0, 5).toString() === '%PDF-' && pdf.headers.get('cache-control') === 'no-store')

    const ataRow = (await db.query("SELECT id FROM project_line_items WHERE org_id = $1 AND project_id = $2 AND type = 'ata' LIMIT 1", [s.orgA, s.p1])).rows[0]
    const ataId = Number(ataRow.id)
    check('ej godkänd ÄTA kan inte hämtas', (await call('POST', `/api/projects/${s.p1}/billing/ata-import`, pm.cookie, { ids: [ataId] })).status === 400)
    check('member godkänner ÄTA', (await call('PUT', `/api/line-items/${ataId}`, pm.cookie, { ata_status: 'godkand' })).body?.ata_status === 'godkand')
    const [i1, i2] = await Promise.all([
      call('POST', `/api/projects/${s.p1}/billing/ata-import`, pm.cookie, { ids: [ataId] }),
      call('POST', `/api/projects/${s.p1}/billing/ata-import`, kontor.cookie, { ids: [ataId] }),
    ])
    const ataParts = Number((await db.query("SELECT count(*)::int AS n FROM billing_parts WHERE kind = 'ata' AND ata_line_item_id = $1", [ataId])).rows[0].n)
    check('samtidig hämtning: exakt en lyckas, en 409, en del i DB', [i1.status, i2.status].sort().join() === '200,409' && ataParts === 1, [i1.status, i2.status, ataParts, i1.status === 500 ? i1.body : i2.body])
    check('hämtad ÄTA kan inte avgodkännas eller tas bort', (await call('PUT', `/api/line-items/${ataId}`, pm.cookie, { ata_status: 'utkast' })).status === 409 && (await call('DELETE', `/api/line-items/${ataId}`, pm.cookie)).status === 409)

    const billingPaths: [string, string, unknown?][] = [
      ['GET', `/api/projects/${s.p1}/billing`],
      ['PUT', `/api/projects/${s.p1}/billing`, { base_total_inc: '1' }],
      ['PUT', `/api/projects/${s.p1}/billing/lines`, { lines: [] }],
      ['PUT', `/api/projects/${s.p1}/billing/installments`, { installments: [] }],
      ['PUT', `/api/projects/${s.p1}/billing/allocations`, { allocations: [] }],
      ['POST', `/api/projects/${s.p1}/billing/allocations-reset`, {}],
      ['GET', `/api/projects/${s.p1}/billing/ata`],
      ['POST', `/api/projects/${s.p1}/billing/ata-import`, { ids: [ataId] }],
      ['GET', `/api/billing/parts/${part1}`],
      ['PUT', `/api/billing/parts/${part1}`, { notes: 'x' }],
      ['DELETE', `/api/billing/parts/${part1}`],
      ['POST', `/api/billing/parts/${part1}/status`, { status: 'klar' }],
      ['POST', `/api/billing/parts/${part1}/payments`, { customer_paid: '1' }],
      ['POST', `/api/billing/parts/${part1}/correction`, {}],
      ['GET', `/api/billing/parts/${part1}/pdf`],
      ['GET', '/api/billing/documents/1/pdf'],
      ['GET', '/api/billing/company'],
      ['PUT', '/api/billing/company', {}],
    ]
    for (const [who, u, expected] of [['personal (Anna)', anna, [403]], ['redovisning', rev, [403]], ['annan org (admin B)', bchef, [404, 403]]] as const) {
      const leaks: string[] = []
      for (const [m, p, body] of billingPaths) {
        // Företagsuppgifterna är org-egna – annan org får läsa/skriva SINA uppgifter.
        if (who.startsWith('annan org') && p.startsWith('/api/billing/company')) continue
        const r = await call(m, p, u.cookie, body)
        if (!(expected as readonly number[]).includes(r.status)) leaks.push(`${m} ${p} → ${r.status}`)
      }
      check(`${who} nekas alla ${billingPaths.length} fakturerings-anrop inkl. PDF`, leaks.length === 0, leaks)
    }
    check('member kan inte ändra företagsuppgifter (endast admin)', (await call('PUT', '/api/billing/company', pm.cookie, { bankgiro: '1' })).status === 403)
    check('admin sparar företagsuppgifter', (await call('PUT', '/api/billing/company', adm.cookie, { organization_number: '556677-8899', f_skatt: true })).body?.organization_number === '556677-8899')
    const ataPartsAfter = Number((await db.query("SELECT count(*)::int AS n FROM billing_parts WHERE kind = 'ata'", [])).rows[0].n)
    check('nekade anrop ändrade ingenting', ataPartsAfter === 1)

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
