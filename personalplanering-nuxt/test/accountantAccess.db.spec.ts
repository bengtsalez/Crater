import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './pgliteDb'
import { seed } from './seed'
import { getAccountantProject, listAccountantProjects } from '../server/utils/accountantAccess'

// Redovisningsvyn mot riktig Postgres (PGlite) med appens fullständiga schema.
const TODAY = '2026-09-30'
let db: TestDb
let s: Awaited<ReturnType<typeof seed>>

beforeAll(async () => {
  db = await createTestDb()
  s = await seed(db, TODAY)
  const item = (org: number, p: number, type: string, amount: number) =>
    db.query(
      "INSERT INTO project_line_items (org_id, project_id, type, description, amount, date, notes) VALUES ($1,$2,$3,$4,$5,'2026-09-10','HEMLIG RADNOTERING')",
      [org, p, type, `${type} ${amount}`, amount]
    )
  await item(s.orgA, s.p1, 'ata', 1000)
  await item(s.orgA, s.p1, 'ata', 250.5)
  await item(s.orgA, s.p1, 'utgift', 400)
  await item(s.orgB, s.p3, 'ata', 777)
}, 60000)
afterAll(() => db.close())

describe('listAccountantProjects', () => {
  it('visar bara den egna org:ens projekt, med kund och summor', async () => {
    const list = await listAccountantProjects(db, s.orgA)
    expect(list.map((p) => p.id)).toEqual([s.p1, s.p2])
    const p1 = list[0]!
    expect(p1).toMatchObject({
      customer_name: 'Kund AB',
      customer_organization_number: '556000-0000',
      customer_city: 'Malmö',
      project_manager_username: 'pm',
      sum: 999999,
      ata_total: 1250.5,
      expense_total: 400,
    })
    expect(list[1]).toMatchObject({ customer_name: null, ata_total: 0, expense_total: 0 })
  })

  it('läcker inga interna anteckningar', async () => {
    const list = await listAccountantProjects(db, s.orgA)
    expect(JSON.stringify(list)).not.toMatch(/INTERN|HEMLIG/)
    expect(Object.keys(list[0]!)).not.toContain('notes')
  })
})

describe('getAccountantProject', () => {
  it('ger fullständiga kund- och faktureringsuppgifter samt ÄTA/utgifter', async () => {
    const d = await getAccountantProject(db, s.orgA, s.p1)
    expect(d!.customer).toMatchObject({
      name: 'Kund AB',
      organization_number: '556000-0000',
      email: 'kund@x.se',
      billing_address: 'Faktura 1',
      invoice_reference: 'REF',
    })
    expect(d!.line_items.map((i) => [i.type, i.amount])).toEqual([['ata', 1000], ['ata', 250.5], ['utgift', 400]])
    expect(JSON.stringify(d)).not.toMatch(/INTERN|HEMLIG/)
  })

  it('annan org eller ogiltigt id → null', async () => {
    expect(await getAccountantProject(db, s.orgA, s.p3)).toBeNull()
    expect(await getAccountantProject(db, s.orgA, 0)).toBeNull()
    expect(await getAccountantProject(db, s.orgA, Number('abc'))).toBeNull()
  })
})
