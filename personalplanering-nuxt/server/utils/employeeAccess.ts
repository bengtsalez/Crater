// Behörighetslogik och frågor för personalvyn (rollen 'employee').
//
// Filen får INTE röra Nitros auto-imports (createError/apiError/pool …) – den
// testas direkt med vitest mot en riktig Postgres (PGlite), se
// employeeAccess.db.spec.ts. Anropande route översätter `null` till 404.
//
// Grundregel: varje fråga utgår från serververifierad identitet (org, userId,
// resourceId från DB via auth-middlewaren). Klienten bidrar bara med
// projekt-/uppgifts-id i URL:en, och de kontrolleras alltid mot en egen bokning.

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

// ---- Sökvägs-allowlist (används av server/middleware/auth.ts) ----

const EMPLOYEE_EXACT_PATHS = new Set(['/api/me', '/api/logout'])
const EMPLOYEE_PREFIX = '/api/employee/'

// Normaliserar en request-sökväg så att allowlisten inte kan kringgås med
// `//`, `/./`, `/../`, procentkodning eller versaler. Returnerar null om
// sökvägen inte går att avkoda – då nekas anropet.
export function normalizeApiPath(rawPath: string): string | null {
  const pathOnly = (rawPath.split('?')[0] ?? '').split('#')[0] ?? ''
  let decoded: string
  try {
    decoded = decodeURIComponent(pathOnly)
  } catch {
    return null
  }
  if (decoded.includes('\\') || decoded.includes('\0')) return null
  const out: string[] = []
  for (const seg of decoded.toLowerCase().split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      out.pop()
      continue
    }
    out.push(seg)
  }
  return '/' + out.join('/')
}

// Deny-by-default: personal får bara nå /api/me, /api/logout och /api/employee/**.
export function isEmployeeAllowedPath(rawPath: string): boolean {
  const path = normalizeApiPath(rawPath)
  if (!path) return false
  if (EMPLOYEE_EXACT_PATHS.has(path)) return true
  return path.startsWith(EMPLOYEE_PREFIX) && path.length > EMPLOYEE_PREFIX.length
}

// Deny-by-default för redovisningskonsulten (rollen 'accountant'): bara
// /api/me, /api/logout och den skrivskyddade /api/accountant/**.
const ACCOUNTANT_PREFIX = '/api/accountant/'

export function isAccountantAllowedPath(rawPath: string): boolean {
  const path = normalizeApiPath(rawPath)
  if (!path) return false
  if (EMPLOYEE_EXACT_PATHS.has(path)) return true
  return path.startsWith(ACCOUNTANT_PREFIX) && path.length > ACCOUNTANT_PREFIX.length
}

// ---- Sessionsanvändare (läses från DB på varje skyddat anrop) ----

export interface SessionUserRow {
  id: number
  username: string
  org_id: number
  role: string
  active: boolean
  resource_id: number | null
}

export async function loadSessionUser(db: Queryable, userId: number): Promise<SessionUserRow | null> {
  const { rows } = await db.query(
    'SELECT id, username, org_id, role, active, resource_id FROM users WHERE id = $1',
    [userId]
  )
  const row = rows[0]
  if (!row) return null
  return { ...row, org_id: Number(row.org_id) }
}

// ---- Resurskoppling ----

export async function findEmployeeResource(
  db: Queryable,
  orgId: number,
  resourceId: number
): Promise<{ id: number; name: string } | null> {
  const { rows } = await db.query('SELECT id, name FROM resources WHERE id = $1 AND org_id = $2', [resourceId, orgId])
  return rows[0] ?? null
}

// ---- Tillåtna fält ----

export const STAFF_CUSTOMER_FIELDS = ['name', 'contact_person', 'phone', 'mobile', 'address', 'postal_code', 'city'] as const

export type StaffCustomer = { [K in (typeof STAFF_CUSTOMER_FIELDS)[number]]: string | null }

// Whitelist – org.nr, e-post, fakturauppgifter, referens och interna
// anteckningar lämnar aldrig servern till personalvyn.
export function pickCustomerFieldsForStaff(row: Record<string, unknown> | null | undefined): StaffCustomer | null {
  if (!row) return null
  const out = {} as StaffCustomer
  for (const f of STAFF_CUSTOMER_FIELDS) {
    const v = row[f]
    out[f] = v === undefined || v === null || v === '' ? null : String(v)
  }
  return out
}

export interface EmployeeScope {
  org: number
  userId: number
  resourceId: number
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && ISO_DATE_RE.test(v)
}

// Dagens datum i svensk tid – servern kör i UTC, men "idag" ska följa arbetsdagen.
export function stockholmToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(now)
}

// ---- Mina arbeten ----

export interface EmployeeJobRow {
  assignment_id: number
  start_date: string
  end_date: string
  note: string | null
  project_id: number
  project_number: string
  project_name: string
  site_address: string | null
  work_type: string
  remaining_tasks: number
}

// Den inloggades bokningar ur den ordinarie planeringen (assignments).
// Utan intervall: allt som pågår idag eller senare. Med intervall: bokningar
// som överlappar [from, to].
export async function listEmployeeJobs(
  db: Queryable,
  scope: EmployeeScope,
  range: { from?: string | null; to?: string | null; today: string }
): Promise<EmployeeJobRow[]> {
  const from = isIsoDate(range.from) ? range.from : range.today
  const to = isIsoDate(range.to) ? range.to : null
  const { rows } = await db.query(
    `SELECT a.id AS assignment_id, a.start_date, a.end_date, a.note,
            p.id AS project_id, p.project_number, p.name AS project_name, p.site_address, p.work_type,
            (SELECT count(*)::int FROM tasks t
              WHERE t.org_id = a.org_id AND t.user_id = $3 AND t.project_id = p.id AND t.status <> 'avslutad') AS remaining_tasks
     FROM assignments a
     JOIN projects p ON p.id = a.project_id AND p.org_id = a.org_id
     WHERE a.org_id = $1 AND a.resource_id = $2
       AND a.end_date >= $4
       AND ($5::text IS NULL OR a.start_date <= $5::text)
     ORDER BY a.start_date, a.end_date, a.id`,
    [scope.org, scope.resourceId, scope.userId, from, to]
  )
  return rows.map((r) => ({ ...r, remaining_tasks: Number(r.remaining_tasks) }))
}

// ---- Ett arbete ----

export interface EmployeeTaskRow {
  id: number
  title: string
  notes: string | null
  status: string
  due_date: string | null
  completed_at: string | null
}

export interface EmployeeJobDetail {
  project: { id: number; project_number: string; name: string; site_address: string | null; work_type: string }
  my_bookings: { id: number; start_date: string; end_date: string; note: string | null }[]
  project_manager: { username: string; phone: string | null; email: string | null } | null
  customer: StaffCustomer | null
  staff_info: { instructions: string; updated_at: string; updated_by: string | null } | null
  tasks: EmployeeTaskRow[]
}

export async function getEmployeeJob(
  db: Queryable,
  scope: EmployeeScope,
  projectId: number
): Promise<EmployeeJobDetail | null> {
  if (!Number.isInteger(projectId) || projectId <= 0) return null

  // Åtkomst = minst en egen bokning på projektet inom org:en. Borttagen
  // bokning → ingen åtkomst längre.
  const bookings = await db.query(
    `SELECT id, start_date, end_date, note FROM assignments
     WHERE org_id = $1 AND resource_id = $2 AND project_id = $3
     ORDER BY start_date, id`,
    [scope.org, scope.resourceId, projectId]
  )
  if (!bookings.rows.length) return null

  const { rows: projectRows } = await db.query(
    `SELECT id, project_number, name, site_address, work_type, customer_id, client, project_manager_user_id
     FROM projects WHERE id = $1 AND org_id = $2`,
    [projectId, scope.org]
  )
  const p = projectRows[0]
  if (!p) return null

  const [pm, customer, info, tasks] = await Promise.all([
    p.project_manager_user_id
      ? db.query('SELECT username, phone, email FROM users WHERE id = $1 AND org_id = $2 AND active', [
          p.project_manager_user_id,
          scope.org,
        ])
      : Promise.resolve({ rows: [] as any[] }),
    p.customer_id
      ? db.query(
          `SELECT ${STAFF_CUSTOMER_FIELDS.join(', ')} FROM customers WHERE id = $1 AND org_id = $2`,
          [p.customer_id, scope.org]
        )
      : Promise.resolve({ rows: [] as any[] }),
    db.query(
      `SELECT s.instructions, s.updated_at, u.username AS updated_by
       FROM project_staff_info s
       LEFT JOIN users u ON u.id = s.updated_by_user_id AND u.org_id = s.org_id
       WHERE s.project_id = $1 AND s.org_id = $2 AND s.published
         AND s.instructions IS NOT NULL AND btrim(s.instructions) <> ''`,
      [projectId, scope.org]
    ),
    listEmployeeTasksForProject(db, scope, projectId),
  ])

  const customerRow = customer.rows[0] ?? (p.client ? { name: p.client } : null)

  return {
    project: {
      id: p.id,
      project_number: p.project_number,
      name: p.name,
      site_address: p.site_address,
      work_type: p.work_type,
    },
    my_bookings: bookings.rows,
    project_manager: pm.rows[0] ?? null,
    customer: pickCustomerFieldsForStaff(customerRow),
    staff_info: info.rows[0]
      ? {
          instructions: info.rows[0].instructions,
          updated_at: new Date(info.rows[0].updated_at).toISOString(),
          updated_by: info.rows[0].updated_by ?? null,
        }
      : null,
    tasks,
  }
}

export async function listEmployeeTasksForProject(
  db: Queryable,
  scope: EmployeeScope,
  projectId: number
): Promise<EmployeeTaskRow[]> {
  const { rows } = await db.query(
    `SELECT id, title, notes, status, due_date, completed_at FROM tasks
     WHERE org_id = $1 AND user_id = $2 AND project_id = $3
     ORDER BY (status = 'avslutad'), due_date NULLS LAST, created_at, id`,
    [scope.org, scope.userId, projectId]
  )
  return rows
}

// ---- Status på egen uppgift ----

export const EMPLOYEE_TASK_STATUSES = ['aktiv', 'avslutad'] as const

// Uppgiften måste vara tilldelad den inloggade, ligga i samma org OCH höra
// till ett projekt där personen har en bokning. Annars null (→ 404).
export async function setEmployeeTaskStatus(
  db: Queryable,
  scope: EmployeeScope,
  taskId: number,
  status: string
): Promise<{ previous: { status: string; title: string; project_id: number }; task: EmployeeTaskRow } | null> {
  if (!Number.isInteger(taskId) || taskId <= 0) return null
  if (!(EMPLOYEE_TASK_STATUSES as readonly string[]).includes(status)) return null

  const { rows } = await db.query(
    `SELECT t.id, t.status, t.title, t.project_id FROM tasks t
     WHERE t.id = $1 AND t.org_id = $2 AND t.user_id = $3 AND t.project_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM assignments a
                   WHERE a.org_id = t.org_id AND a.resource_id = $4 AND a.project_id = t.project_id)`,
    [taskId, scope.org, scope.userId, scope.resourceId]
  )
  const existing = rows[0]
  if (!existing) return null

  const updated = await db.query(
    `UPDATE tasks
     SET status = $1,
         completed_at = CASE WHEN $1 = 'avslutad' THEN COALESCE(completed_at, now()) ELSE NULL END
     WHERE id = $2 AND org_id = $3 AND user_id = $4
     RETURNING id, title, notes, status, due_date, completed_at`,
    [status, taskId, scope.org, scope.userId]
  )
  if (!updated.rows[0]) return null
  return {
    previous: { status: existing.status, title: existing.title, project_id: existing.project_id },
    task: updated.rows[0],
  }
}
