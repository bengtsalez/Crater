const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Resources (anställda / underentreprenörer) ----------

app.get('/api/resources', (req, res) => {
  const rows = db.prepare('SELECT * FROM resources ORDER BY type, name').all();
  res.json(rows);
});

app.post('/api/resources', (req, res) => {
  const { name, type, phone, active } = req.body;
  if (!name || !['anstalld', 'underentreprenor'].includes(type)) {
    return res.status(400).json({ error: 'Namn och giltig typ krävs.' });
  }
  const info = db
    .prepare('INSERT INTO resources (name, type, phone, active) VALUES (?, ?, ?, ?)')
    .run(name, type, phone || null, active === false ? 0 : 1);
  res.status(201).json(db.prepare('SELECT * FROM resources WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/resources/:id', (req, res) => {
  const { name, type, phone, active } = req.body;
  const existing = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Hittades inte.' });
  db.prepare('UPDATE resources SET name=?, type=?, phone=?, active=? WHERE id=?').run(
    name ?? existing.name,
    type ?? existing.type,
    phone ?? existing.phone,
    active === undefined ? existing.active : (active ? 1 : 0),
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id));
});

app.delete('/api/resources/:id', (req, res) => {
  db.prepare('DELETE FROM resources WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Projects ----------

app.get('/api/projects', (req, res) => {
  const rows = db.prepare('SELECT * FROM projects ORDER BY project_number').all();
  res.json(rows);
});

app.get('/api/projects/next-number', (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'next_project_number'").get();
  res.json({ next: 'P' + row.value });
});

const nextProjectNumber = db.transaction(() => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'next_project_number'").get();
  const current = Number(row.value);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'next_project_number'").run(String(current + 1));
  return 'P' + current;
});

app.post('/api/projects', (req, res) => {
  const { name, client, project_manager, sum, start_date, end_date, status, notes } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Namn krävs.' });
  }
  const project_number = nextProjectNumber();
  const info = db
    .prepare(
      `INSERT INTO projects (project_number, name, client, project_manager, sum, start_date, end_date, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      project_number,
      name,
      client || null,
      project_manager || null,
      sum === '' || sum === undefined ? null : sum,
      start_date || null,
      end_date || null,
      status || 'aktiv',
      notes || null
    );
  res.status(201).json(db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/projects/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Hittades inte.' });
  const b = req.body;
  db.prepare(
    `UPDATE projects SET project_number=?, name=?, client=?, project_manager=?, sum=?, start_date=?, end_date=?, status=?, notes=?
     WHERE id=?`
  ).run(
    b.project_number ?? existing.project_number,
    b.name ?? existing.name,
    b.client ?? existing.client,
    b.project_manager ?? existing.project_manager,
    b.sum === '' ? null : (b.sum ?? existing.sum),
    b.start_date ?? existing.start_date,
    b.end_date ?? existing.end_date,
    b.status ?? existing.status,
    b.notes ?? existing.notes,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
});

app.delete('/api/projects/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Assignments (bokningar i kalendern) ----------

app.get('/api/assignments', (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, r.name AS resource_name, r.type AS resource_type,
              p.project_number, p.name AS project_name
       FROM assignments a
       JOIN resources r ON r.id = a.resource_id
       JOIN projects p ON p.id = a.project_id
       ORDER BY a.start_date`
    )
    .all();
  res.json(rows);
});

app.post('/api/assignments', (req, res) => {
  const { resource_id, project_id, start_date, end_date, note } = req.body;
  if (!resource_id || !project_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'Resurs, projekt, startdatum och slutdatum krävs.' });
  }
  if (end_date < start_date) {
    return res.status(400).json({ error: 'Slutdatum kan inte vara före startdatum.' });
  }
  const info = db
    .prepare('INSERT INTO assignments (resource_id, project_id, start_date, end_date, note) VALUES (?, ?, ?, ?, ?)')
    .run(resource_id, project_id, start_date, end_date, note || null);
  const row = db
    .prepare(
      `SELECT a.*, r.name AS resource_name, r.type AS resource_type,
              p.project_number, p.name AS project_name
       FROM assignments a JOIN resources r ON r.id = a.resource_id JOIN projects p ON p.id = a.project_id
       WHERE a.id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json(row);
});

app.put('/api/assignments/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Hittades inte.' });
  const b = req.body;
  const start_date = b.start_date ?? existing.start_date;
  const end_date = b.end_date ?? existing.end_date;
  if (end_date < start_date) {
    return res.status(400).json({ error: 'Slutdatum kan inte vara före startdatum.' });
  }
  db.prepare(
    'UPDATE assignments SET resource_id=?, project_id=?, start_date=?, end_date=?, note=? WHERE id=?'
  ).run(
    b.resource_id ?? existing.resource_id,
    b.project_id ?? existing.project_id,
    start_date,
    end_date,
    b.note ?? existing.note,
    req.params.id
  );
  const row = db
    .prepare(
      `SELECT a.*, r.name AS resource_name, r.type AS resource_type,
              p.project_number, p.name AS project_name
       FROM assignments a JOIN resources r ON r.id = a.resource_id JOIN projects p ON p.id = a.project_id
       WHERE a.id = ?`
    )
    .get(req.params.id);
  res.json(row);
});

app.delete('/api/assignments/:id', (req, res) => {
  db.prepare('DELETE FROM assignments WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Personalplanering körs på port ${PORT}`);
});
