const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { pool, ready, nextProjectNumber } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET saknas i miljövariabler.');
}
const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dagar

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(async (req, res, next) => {
  try {
    await ready;
    next();
  } catch (err) {
    next(err);
  }
});

// ---------- Auth ----------

const PUBLIC_PATHS = new Set(['/login.html', '/api/login']);

app.post('/api/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Användarnamn och lösenord krävs.' });
    }
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    const valid = user && (await bcrypt.compare(password, user.password_hash));
    if (!valid) {
      return res.status(401).json({ error: 'Fel användarnamn eller lösenord.' });
    }
    const token = jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, {
      expiresIn: SESSION_MAX_AGE_MS / 1000,
    });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_MAX_AGE_MS,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  const payload = token && verifySession(token);
  if (!payload) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Ej inloggad.' });
    }
    return res.redirect('/login.html');
  }
  req.user = payload;
  next();
});

function verifySession(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Resources (anställda / underentreprenörer) ----------

app.get('/api/resources', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM resources ORDER BY type, name');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.post('/api/resources', async (req, res, next) => {
  try {
    const { name, type, phone, active } = req.body;
    if (!name || !['anstalld', 'underentreprenor'].includes(type)) {
      return res.status(400).json({ error: 'Namn och giltig typ krävs.' });
    }
    const { rows } = await pool.query(
      'INSERT INTO resources (name, type, phone, active) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, type, phone || null, active === false ? 0 : 1]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.put('/api/resources/:id', async (req, res, next) => {
  try {
    const { name, type, phone, active } = req.body;
    const existingResult = await pool.query('SELECT * FROM resources WHERE id = $1', [req.params.id]);
    const existing = existingResult.rows[0];
    if (!existing) return res.status(404).json({ error: 'Hittades inte.' });
    const { rows } = await pool.query(
      'UPDATE resources SET name=$1, type=$2, phone=$3, active=$4 WHERE id=$5 RETURNING *',
      [
        name ?? existing.name,
        type ?? existing.type,
        phone ?? existing.phone,
        active === undefined ? existing.active : (active ? 1 : 0),
        req.params.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/resources/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM resources WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------- Projects ----------

app.get('/api/projects', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM projects ORDER BY project_number');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get('/api/projects/next-number', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT value FROM settings WHERE key = 'next_project_number'"
    );
    res.json({ next: 'P' + rows[0].value });
  } catch (err) {
    next(err);
  }
});

app.post('/api/projects', async (req, res, next) => {
  try {
    const { name, client, project_manager, sum, start_date, end_date, status, notes } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Namn krävs.' });
    }
    const project_number = await nextProjectNumber();
    const { rows } = await pool.query(
      `INSERT INTO projects (project_number, name, client, project_manager, sum, start_date, end_date, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        project_number,
        name,
        client || null,
        project_manager || null,
        sum === '' || sum === undefined ? null : sum,
        start_date || null,
        end_date || null,
        status || 'aktiv',
        notes || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.put('/api/projects/:id', async (req, res, next) => {
  try {
    const existingResult = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    const existing = existingResult.rows[0];
    if (!existing) return res.status(404).json({ error: 'Hittades inte.' });
    const b = req.body;
    const { rows } = await pool.query(
      `UPDATE projects SET project_number=$1, name=$2, client=$3, project_manager=$4, sum=$5, start_date=$6, end_date=$7, status=$8, notes=$9
       WHERE id=$10 RETURNING *`,
      [
        b.project_number ?? existing.project_number,
        b.name ?? existing.name,
        b.client ?? existing.client,
        b.project_manager ?? existing.project_manager,
        b.sum === '' ? null : (b.sum ?? existing.sum),
        b.start_date ?? existing.start_date,
        b.end_date ?? existing.end_date,
        b.status ?? existing.status,
        b.notes ?? existing.notes,
        req.params.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/projects/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------- Assignments (bokningar i kalendern) ----------

const ASSIGNMENT_SELECT = `
  SELECT a.*, r.name AS resource_name, r.type AS resource_type,
         p.project_number, p.name AS project_name
  FROM assignments a
  JOIN resources r ON r.id = a.resource_id
  JOIN projects p ON p.id = a.project_id
`;

app.get('/api/assignments', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${ASSIGNMENT_SELECT} ORDER BY a.start_date`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.post('/api/assignments', async (req, res, next) => {
  try {
    const { resource_id, project_id, start_date, end_date, note } = req.body;
    if (!resource_id || !project_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'Resurs, projekt, startdatum och slutdatum krävs.' });
    }
    if (end_date < start_date) {
      return res.status(400).json({ error: 'Slutdatum kan inte vara före startdatum.' });
    }
    const inserted = await pool.query(
      'INSERT INTO assignments (resource_id, project_id, start_date, end_date, note) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [resource_id, project_id, start_date, end_date, note || null]
    );
    const { rows } = await pool.query(`${ASSIGNMENT_SELECT} WHERE a.id = $1`, [inserted.rows[0].id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.put('/api/assignments/:id', async (req, res, next) => {
  try {
    const existingResult = await pool.query('SELECT * FROM assignments WHERE id = $1', [req.params.id]);
    const existing = existingResult.rows[0];
    if (!existing) return res.status(404).json({ error: 'Hittades inte.' });
    const b = req.body;
    const start_date = b.start_date ?? existing.start_date;
    const end_date = b.end_date ?? existing.end_date;
    if (end_date < start_date) {
      return res.status(400).json({ error: 'Slutdatum kan inte vara före startdatum.' });
    }
    await pool.query(
      'UPDATE assignments SET resource_id=$1, project_id=$2, start_date=$3, end_date=$4, note=$5 WHERE id=$6',
      [
        b.resource_id ?? existing.resource_id,
        b.project_id ?? existing.project_id,
        start_date,
        end_date,
        b.note ?? existing.note,
        req.params.id,
      ]
    );
    const { rows } = await pool.query(`${ASSIGNMENT_SELECT} WHERE a.id = $1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/assignments/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM assignments WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = app;
