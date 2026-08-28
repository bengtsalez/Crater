const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const FIRST_PROJECT_NUMBER = 1115;

const ready = pool
  .query(
    `
    CREATE TABLE IF NOT EXISTS resources (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('anstalld','underentreprenor')),
      phone TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      project_number TEXT NOT NULL,
      name TEXT NOT NULL,
      client TEXT,
      project_manager TEXT,
      sum REAL,
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'aktiv',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id SERIAL PRIMARY KEY,
      resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );

    ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_manager_user_id INTEGER REFERENCES users(id);

    ALTER TABLE resources ADD COLUMN IF NOT EXISTS category TEXT;

    ALTER TABLE resources ADD COLUMN IF NOT EXISTS color TEXT;

    ALTER TABLE projects ADD COLUMN IF NOT EXISTS category TEXT;

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'aktiv',
      due_date TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      completed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_line_items (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('ata', 'utgift')),
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `
  );

async function highestProjectNumber(client) {
  const { rows } = await client.query(
    `SELECT MAX(NULLIF(regexp_replace(project_number, '[^0-9]', '', 'g'), '')::integer) AS max_number
     FROM projects`
  );
  return rows[0].max_number ? Number(rows[0].max_number) : FIRST_PROJECT_NUMBER - 1;
}

async function nextProjectNumber() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize against concurrent inserts since there's no single counter row to lock.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('next_project_number'))");
    const current = (await highestProjectNumber(client)) + 1;
    await client.query('COMMIT');
    return 'P' + current;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, ready, nextProjectNumber, highestProjectNumber };
