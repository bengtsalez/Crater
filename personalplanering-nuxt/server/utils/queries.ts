// Join-fragment. `org_id`-guards på varje join är defense-in-depth; anropande
// route lägger alltid till ett `WHERE <t>.org_id = $1` (eller `AND ...`).

export const PROJECT_SELECT = `
  SELECT p.*, u.username AS project_manager_username
  FROM projects p
  LEFT JOIN users u ON u.id = p.project_manager_user_id AND u.org_id = p.org_id
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
