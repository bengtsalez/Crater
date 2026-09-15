// Join-fragment. `org_id`-guards på varje join är defense-in-depth; anropande
// route lägger alltid till ett `WHERE <t>.org_id = $1` (eller `AND ...`).

export const PROJECT_SELECT = `
  SELECT p.*, u.username AS project_manager_username, c.name AS customer_name
  FROM projects p
  LEFT JOIN users u ON u.id = p.project_manager_user_id AND u.org_id = p.org_id
  LEFT JOIN customers c ON c.id = p.customer_id AND c.org_id = p.org_id
`

// project_count/last_project_* driver både Kunder-listan och kundväljarens
// förslagsrad (org.nr · ort · N projekt).
export const CUSTOMER_SELECT = `
  SELECT c.*,
         COALESCE(pc.project_count, 0)::int AS project_count,
         lp.project_number AS last_project_number,
         lp.name           AS last_project_name,
         lp.start_date     AS last_project_date
  FROM customers c
  LEFT JOIN (
    SELECT customer_id, org_id, count(*) AS project_count
    FROM projects WHERE customer_id IS NOT NULL GROUP BY customer_id, org_id
  ) pc ON pc.customer_id = c.id AND pc.org_id = c.org_id
  LEFT JOIN LATERAL (
    SELECT p.project_number, p.name, p.start_date
    FROM projects p
    WHERE p.customer_id = c.id AND p.org_id = c.org_id
    ORDER BY COALESCE(p.start_date, '') DESC, p.id DESC
    LIMIT 1
  ) lp ON TRUE
`

export const ASSIGNMENT_SELECT = `
  SELECT a.*, r.name AS resource_name, r.type AS resource_type,
         p.project_number, p.name AS project_name
  FROM assignments a
  JOIN resources r ON r.id = a.resource_id AND r.org_id = a.org_id
  JOIN projects p ON p.id = a.project_id AND p.org_id = a.org_id
`

export const TASK_SELECT = `
  SELECT t.*, p.project_number, p.name AS project_name
  FROM tasks t
  LEFT JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
`
