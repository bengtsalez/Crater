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
  `
  )
  .then(() =>
    pool.query(
      `INSERT INTO settings (key, value) VALUES ('next_project_number', $1)
       ON CONFLICT (key) DO NOTHING`,
      [String(FIRST_PROJECT_NUMBER)]
    )
  );

async function nextProjectNumber() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "SELECT value FROM settings WHERE key = 'next_project_number' FOR UPDATE"
    );
    const current = Number(rows[0].value);
    await client.query(
      "UPDATE settings SET value = $1 WHERE key = 'next_project_number'",
      [String(current + 1)]
    );
    await client.query('COMMIT');
    return 'P' + current;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, ready, nextProjectNumber };
