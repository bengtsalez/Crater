import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './pgliteDb'
import { seed } from './seed'
import {
  findEmployeeResource,
  getEmployeeJob,
  listEmployeeJobs,
  loadSessionUser,
  setEmployeeTaskStatus,
} from '../server/utils/employeeAccess'

// Integrationstester mot riktig Postgres (PGlite) med appens fullständiga
// schema. Täcker scenarierna i uppdraget som rör dataåtkomst.
const TODAY = '2026-09-30'
let db: TestDb
let s: Awaited<ReturnType<typeof seed>>

beforeAll(async () => {
  db = await createTestDb()
  s = await seed(db, TODAY)
}, 60000)
afterAll(() => db.close())

const annaScope = () => ({ org: s.orgA, userId: s.anna, resourceId: s.rAnna })
const boScope = () => ({ org: s.orgA, userId: s.bo, resourceId: s.rBo })

describe('1. två anställda ser bara sina egna bokningar och uppgifter', () => {
  it('Anna ser sina två bokningar på P1 men inte Bos eller passerade', async () => {
    const jobs = await listEmployeeJobs(db, annaScope(), { today: TODAY })
    expect(jobs.map((j) => j.assignment_id)).toEqual([s.aAnnaP1a, s.aAnnaP1b])
    expect(jobs.every((j) => j.project_id === s.p1)).toBe(true)
    expect(jobs[0]!.remaining_tasks).toBe(1)
  })

  it('Bo ser bara sin bokning', async () => {
    const jobs = await listEmployeeJobs(db, boScope(), { today: TODAY })
    expect(jobs.map((j) => j.assignment_id)).toEqual([s.aBoP2])
  })

  it('intervall filtrerar på överlapp (även bakåt i tiden)', async () => {
    const past = await listEmployeeJobs(db, annaScope(), { today: TODAY, from: '2026-09-01', to: '2026-09-15' })
    expect(past.map((j) => j.assignment_id)).toEqual([s.aAnnaPast])
    const thisWeek = await listEmployeeJobs(db, annaScope(), { today: TODAY, from: '2026-09-28', to: '2026-10-04' })
    expect(thisWeek.map((j) => j.assignment_id)).toEqual([s.aAnnaP1a])
  })

  it('jobblistan innehåller inga interna fält', async () => {
    const [job] = await listEmployeeJobs(db, annaScope(), { today: TODAY })
    expect(Object.keys(job!).sort()).toEqual(
      ['assignment_id', 'end_date', 'note', 'project_id', 'project_name', 'project_number', 'remaining_tasks', 'site_address', 'start_date', 'work_type'].sort()
    )
  })

  it('detaljvyn visar bara egna uppgifter (inte PM:s interna uppgift på samma projekt)', async () => {
    const job = await getEmployeeJob(db, annaScope(), s.p1)
    expect(job!.tasks.map((t) => t.id)).toEqual([s.tAnnaP1])
    expect(job!.my_bookings.map((b) => b.id)).toEqual([s.aAnnaP1a, s.aAnnaP1b])
  })
})

describe('2. inget annat arbete via id', () => {
  it('Anna kan inte öppna Bos projekt', async () => {
    expect(await getEmployeeJob(db, annaScope(), s.p2 + 1000)).toBeNull()
    // P2 har Anna bara en passerad bokning på → fortfarande åtkomst (egen bokning),
    // men Bos uppgift syns inte.
    const p2 = await getEmployeeJob(db, annaScope(), s.p2)
    expect(p2!.tasks).toEqual([])
    expect(await getEmployeeJob(db, boScope(), s.p1)).toBeNull()
  })

  it('ogiltiga id:n ger null', async () => {
    expect(await getEmployeeJob(db, annaScope(), NaN)).toBeNull()
    expect(await getEmployeeJob(db, annaScope(), -1)).toBeNull()
  })
})

describe('3. annan organisation', () => {
  it('Anna når inte org B:s projekt', async () => {
    expect(await getEmployeeJob(db, annaScope(), s.p3)).toBeNull()
  })

  it('en förfalskad scope med annan org men egen resurs ger inget', async () => {
    const forged = { org: s.orgB, userId: s.anna, resourceId: s.rAnna }
    expect(await listEmployeeJobs(db, forged, { today: TODAY })).toEqual([])
    expect(await findEmployeeResource(db, s.orgB, s.rAnna)).toBeNull()
  })

  it('Carl (org B) kan inte ändra Annas uppgift', async () => {
    const carl = { org: s.orgB, userId: s.carl, resourceId: s.rCarl }
    expect(await setEmployeeTaskStatus(db, carl, s.tAnnaP1, 'avslutad')).toBeNull()
  })
})

describe('4. interna fält skickas inte', () => {
  it('kund: bara tillåtna fält; projekt: inga anteckningar/ekonomi', async () => {
    const job = await getEmployeeJob(db, annaScope(), s.p1)
    expect(job!.customer).toEqual({
      name: 'Kund AB', contact_person: 'Kalle', phone: '040-1', mobile: '070-2',
      address: 'Kundgatan 1', postal_code: '21100', city: 'Malmö',
    })
    const json = JSON.stringify(job)
    for (const secret of ['INTERN ANTECKNING', 'HEMLIG KUNDNOTERING', '556000-0000', 'kund@x.se', 'Faktura 1', 'REF', '999999', 'PM intern']) {
      expect(json).not.toContain(secret)
    }
    expect(Object.keys(job!.project).sort()).toEqual(['id', 'name', 'project_number', 'site_address', 'work_type'])
    expect(job!.project_manager).toEqual({ username: 'pm', phone: '070-111', email: null })
  })
})

describe('5. egen uppgift kan klarmarkeras, andras inte', () => {
  it('Anna klarmarkerar och återöppnar sin uppgift', async () => {
    const done = await setEmployeeTaskStatus(db, annaScope(), s.tAnnaP1, 'avslutad')
    expect(done!.task.status).toBe('avslutad')
    expect(done!.task.completed_at).not.toBeNull()
    // Syns i projektledarens befintliga vy (samma tasks-rad).
    const pmView = await db.query('SELECT status FROM tasks WHERE id = $1', [s.tAnnaP1])
    expect(pmView.rows[0].status).toBe('avslutad')
    const reopened = await setEmployeeTaskStatus(db, annaScope(), s.tAnnaP1, 'aktiv')
    expect(reopened!.task.status).toBe('aktiv')
    expect(reopened!.task.completed_at).toBeNull()
  })

  it('Anna kan inte ändra Bos eller PM:s uppgift', async () => {
    expect(await setEmployeeTaskStatus(db, annaScope(), s.tBoP2, 'avslutad')).toBeNull()
    expect(await setEmployeeTaskStatus(db, annaScope(), s.tPmP1, 'avslutad')).toBeNull()
    const rows = await db.query('SELECT status FROM tasks WHERE id = ANY($1)', [[s.tBoP2, s.tPmP1]])
    expect(rows.rows.every((r) => r.status === 'aktiv')).toBe(true)
  })

  it('ogiltig status avvisas', async () => {
    expect(await setEmployeeTaskStatus(db, annaScope(), s.tAnnaP1, 'raderad')).toBeNull()
  })
})

describe('6. borttagen tilldelning / avaktiverat konto', () => {
  it('konto utan resurs har ingen resurs att nå data med', async () => {
    const dora = await loadSessionUser(db, s.dora)
    expect(dora!.resource_id).toBeNull()
  })

  it('avaktivering syns i sessionsuppslaget', async () => {
    await db.query('UPDATE users SET active = false WHERE id = $1', [s.bo])
    expect((await loadSessionUser(db, s.bo))!.active).toBe(false)
    await db.query('UPDATE users SET active = true WHERE id = $1', [s.bo])
  })

  it('borttagen bokning stänger arbetet och uppgiften', async () => {
    await db.query('DELETE FROM assignments WHERE id = $1', [s.aBoP2])
    expect(await getEmployeeJob(db, boScope(), s.p2)).toBeNull()
    expect(await listEmployeeJobs(db, boScope(), { today: TODAY })).toEqual([])
    expect(await setEmployeeTaskStatus(db, boScope(), s.tBoP2, 'avslutad')).toBeNull()
  })

  it('borttagen resurs nollställer kopplingen', async () => {
    const r = (await db.query("INSERT INTO resources (org_id, name, type, category) VALUES ($1, 'Tmp', 'anstalld', 'mark') RETURNING id", [s.orgA])).rows[0].id
    const u = (await db.query("INSERT INTO users (org_id, username, password_hash, role, resource_id) VALUES ($1, 'tmp', 'x', 'employee', $2) RETURNING id", [s.orgA, r])).rows[0].id
    await db.query('DELETE FROM resources WHERE id = $1', [r])
    expect((await loadSessionUser(db, u))!.resource_id).toBeNull()
  })

  it('en resurs kan bara ha ett konto', async () => {
    await expect(
      db.query("INSERT INTO users (org_id, username, password_hash, role, resource_id) VALUES ($1, 'anna2', 'x', 'employee', $2)", [s.orgA, s.rAnna])
    ).rejects.toThrow()
  })
})

describe('7. publicerad arbetsinformation', () => {
  it('utkast syns inte, publicerad syns med uppdaterare', async () => {
    await db.query(
      "INSERT INTO project_staff_info (project_id, org_id, instructions, published, updated_by_user_id) VALUES ($1, $2, 'Ta med stege', false, $3)",
      [s.p1, s.orgA, s.pm]
    )
    expect((await getEmployeeJob(db, annaScope(), s.p1))!.staff_info).toBeNull()
    await db.query('UPDATE project_staff_info SET published = true WHERE project_id = $1', [s.p1])
    const info = (await getEmployeeJob(db, annaScope(), s.p1))!.staff_info
    expect(info!.instructions).toBe('Ta med stege')
    expect(info!.updated_by).toBe('pm')
  })
})
