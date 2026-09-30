import type { TestDb } from './pgliteDb'

// Två orgar, två anställda i org A (Anna, Bo), en i org B (Carl), ett
// personalkonto utan resurskoppling (Dora) och en projektledare (pm).
export async function seed(db: TestDb, today: string) {
  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0]
  const orgA = Number((await one("SELECT id FROM organizations WHERE slug = 'byggproffs'")).id)
  const orgB = Number((await one("INSERT INTO organizations (name, slug) VALUES ('Annan AB', 'annan') RETURNING id")).id)

  const res = async (org: number, name: string) =>
    (await one("INSERT INTO resources (org_id, name, type, category) VALUES ($1, $2, 'anstalld', 'mark') RETURNING id", [org, name])).id as number
  const rAnna = await res(orgA, 'Anna')
  const rBo = await res(orgA, 'Bo')
  const rCarl = await res(orgB, 'Carl')

  const user = async (org: number, username: string, role: string, resourceId: number | null, phone: string | null = null) =>
    (await one(
      "INSERT INTO users (org_id, username, password_hash, role, resource_id, phone) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id",
      [org, username, role, resourceId, phone]
    )).id as number
  const pm = await user(orgA, 'pm', 'member', null, '070-111')
  const anna = await user(orgA, 'anna', 'employee', rAnna)
  const bo = await user(orgA, 'bo', 'employee', rBo)
  const carl = await user(orgB, 'carl', 'employee', rCarl)
  const dora = await user(orgA, 'dora', 'employee', null)

  const cust = (await one(
    `INSERT INTO customers (org_id, name, contact_person, phone, mobile, address, postal_code, city,
       organization_number, email, billing_address, invoice_reference, notes)
     VALUES ($1, 'Kund AB', 'Kalle', '040-1', '070-2', 'Kundgatan 1', '21100', 'Malmö',
       '556000-0000', 'kund@x.se', 'Faktura 1', 'REF', 'HEMLIG KUNDNOTERING') RETURNING id`,
    [orgA]
  )).id

  const project = async (org: number, number: string, customerId: unknown = null) =>
    (await one(
      `INSERT INTO projects (org_id, project_number, name, customer_id, client, project_manager_user_id, sum, notes, site_address)
       VALUES ($1, $2, $3, $4, $5, $6, 999999, 'INTERN ANTECKNING', 'Bygggatan 2, Lund') RETURNING id`,
      [org, number, 'Projekt ' + number, customerId, customerId ? 'Kund AB' : null, org === orgA ? pm : null]
    )).id as number
  const p1 = await project(orgA, 'P1', cust)
  const p2 = await project(orgA, 'P2')
  const p3 = await project(orgB, 'P3')

  const addDays = (iso: string, n: number) => {
    const d = new Date(iso + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }
  const booking = async (org: number, r: number, p: number, s: number, e: number) =>
    (await one(
      'INSERT INTO assignments (org_id, resource_id, project_id, start_date, end_date) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [org, r, p, addDays(today, s), addDays(today, e)]
    )).id as number
  const aAnnaP1a = await booking(orgA, rAnna, p1, -1, 2)
  const aAnnaP1b = await booking(orgA, rAnna, p1, 10, 12)
  const aBoP2 = await booking(orgA, rBo, p2, 3, 4)
  const aAnnaPast = await booking(orgA, rAnna, p2, -20, -15)
  await booking(orgB, rCarl, p3, 0, 1)

  const task = async (org: number, u: number, p: number | null, title: string) =>
    (await one(
      'INSERT INTO tasks (org_id, user_id, project_id, title, notes) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [org, u, p, title, 'Instruktion ' + title]
    )).id as number
  const tAnnaP1 = await task(orgA, anna, p1, 'Anna P1')
  const tBoP2 = await task(orgA, bo, p2, 'Bo P2')
  const tPmP1 = await task(orgA, pm, p1, 'PM intern P1')
  const tCarlP3 = await task(orgB, carl, p3, 'Carl P3')

  return {
    orgA, orgB, rAnna, rBo, rCarl, pm, anna, bo, carl, dora, cust, p1, p2, p3,
    aAnnaP1a, aAnnaP1b, aBoP2, aAnnaPast, tAnnaP1, tBoP2, tPmP1, tCarlP3,
  }
}
