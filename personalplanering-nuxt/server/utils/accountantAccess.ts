// Frågor för redovisningsvyn (rollen 'accountant').
//
// Filen får INTE röra Nitros auto-imports (createError/apiError/pool …) – den
// testas direkt med vitest mot en riktig Postgres (PGlite), se
// test/accountantAccess.db.spec.ts. Anropande route översätter `null` till 404.
//
// Redovisningskonsulten ser org:ens alla projekt och ströjobb med kund- och
// faktureringsuppgifter, samt ÄTA/utgifter – allt skrivskyddat. Svaren byggs
// av vitlistade kolumner: projektets interna anteckningar (`projects.notes`),
// kundens interna anteckningar (`customers.notes`) och anteckningar på
// ÄTA/utgiftsrader lämnar aldrig servern hit.

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

export const ACCOUNTANT_CUSTOMER_FIELDS = [
  'name',
  'customer_type',
  'organization_number',
  'contact_person',
  'email',
  'phone',
  'mobile',
  'address',
  'postal_code',
  'city',
  'billing_address',
  'billing_postal_code',
  'billing_city',
  'billing_email',
  'invoice_reference',
] as const

export type AccountantCustomer = { [K in (typeof ACCOUNTANT_CUSTOMER_FIELDS)[number]]: string | null }

export function pickCustomerFieldsForAccountant(
  row: Record<string, unknown> | null | undefined
): AccountantCustomer | null {
  if (!row) return null
  const out = {} as AccountantCustomer
  for (const f of ACCOUNTANT_CUSTOMER_FIELDS) {
    const v = row[f]
    out[f] = v === undefined || v === null || v === '' ? null : String(v)
  }
  return out
}

export interface AccountantProjectRow {
  id: number
  project_number: string
  name: string
  status: string
  work_type: string
  billing_type: string
  sum: number | null
  start_date: string | null
  end_date: string | null
  site_address: string | null
  project_manager_username: string | null
  customer_id: number | null
  customer_name: string | null
  customer_organization_number: string | null
  customer_city: string | null
  ata_total: number
  expense_total: number
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v))

const PROJECT_FIELDS = `
  p.id, p.project_number, p.name, p.status, p.work_type, p.billing_type, p.sum,
  p.start_date, p.end_date, p.site_address, p.customer_id,
  u.username AS project_manager_username
`

const PROJECT_JOINS = `
  FROM projects p
  LEFT JOIN users u ON u.id = p.project_manager_user_id AND u.org_id = p.org_id
  LEFT JOIN customers c ON c.id = p.customer_id AND c.org_id = p.org_id
`

export async function listAccountantProjects(db: Queryable, orgId: number): Promise<AccountantProjectRow[]> {
  const { rows } = await db.query(
    `SELECT ${PROJECT_FIELDS},
            COALESCE(c.name, NULLIF(btrim(p.client), '')) AS customer_name,
            c.organization_number AS customer_organization_number,
            c.city AS customer_city,
            COALESCE(li.ata_total, 0) AS ata_total,
            COALESCE(li.expense_total, 0) AS expense_total
     ${PROJECT_JOINS}
     LEFT JOIN (
       SELECT project_id,
              SUM(amount) FILTER (WHERE type = 'ata') AS ata_total,
              SUM(amount) FILTER (WHERE type = 'utgift') AS expense_total
       FROM project_line_items WHERE org_id = $1 GROUP BY project_id
     ) li ON li.project_id = p.id
     WHERE p.org_id = $1
     ORDER BY p.project_number`,
    [orgId]
  )
  return rows.map((r) => ({
    ...r,
    sum: numOrNull(r.sum),
    customer_id: numOrNull(r.customer_id),
    ata_total: num(r.ata_total),
    expense_total: num(r.expense_total),
  }))
}

export interface AccountantLineItem {
  id: number
  type: 'ata' | 'utgift'
  description: string
  amount: number
  date: string | null
}

export interface AccountantProjectDetail {
  project: Omit<AccountantProjectRow, 'customer_name' | 'customer_organization_number' | 'customer_city' | 'ata_total' | 'expense_total'>
  customer: AccountantCustomer | null
  line_items: AccountantLineItem[]
}

export async function getAccountantProject(
  db: Queryable,
  orgId: number,
  projectId: number
): Promise<AccountantProjectDetail | null> {
  if (!Number.isInteger(projectId) || projectId <= 0) return null

  const { rows } = await db.query(
    `SELECT ${PROJECT_FIELDS}, p.client ${PROJECT_JOINS} WHERE p.id = $1 AND p.org_id = $2`,
    [projectId, orgId]
  )
  const p = rows[0]
  if (!p) return null

  const [customer, items] = await Promise.all([
    p.customer_id
      ? db.query(`SELECT ${ACCOUNTANT_CUSTOMER_FIELDS.join(', ')} FROM customers WHERE id = $1 AND org_id = $2`, [
          p.customer_id,
          orgId,
        ])
      : Promise.resolve({ rows: [] as any[] }),
    db.query(
      `SELECT id, type, description, amount, date FROM project_line_items
       WHERE project_id = $1 AND org_id = $2 ORDER BY date NULLS LAST, id`,
      [projectId, orgId]
    ),
  ])

  const { client, ...project } = p
  const customerRow = customer.rows[0] ?? (client ? { name: client } : null)

  return {
    project: { ...project, sum: numOrNull(project.sum), customer_id: numOrNull(project.customer_id) },
    customer: pickCustomerFieldsForAccountant(customerRow),
    line_items: items.rows.map((r) => ({ ...r, amount: Number(r.amount) })),
  }
}
