const { Pool } = require('pg');

// Build pool from DATABASE_URL; support optional SSL via PGSSL=true
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("DATABASE_URL not set. Set it in backend/.env or environment.");
}

const useSSL = /^true$/i.test(process.env.PGSSL || '') || /^require$/i.test(process.env.PGSSL || '');

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
  max: parseInt(process.env.PGPOOL_MAX || '10', 10),
  idleTimeoutMillis: parseInt(process.env.PGPOOL_IDLE || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.PG_CONNECT_TIMEOUT || '5000', 10),
});

// Optional helper to do one-off queries
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };

// Ensure required tables exist
async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_logs (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT,
      direction TEXT NOT NULL,
      role TEXT,
      content TEXT,
      model TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS chat_logs_created_at_idx ON chat_logs(created_at);
    CREATE INDEX IF NOT EXISTS chat_logs_session_idx ON chat_logs(session_id);

    -- Optional metadata table for sessions (e.g., display names)
    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id TEXT PRIMARY KEY,
      name TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS chat_sessions_updated_at_idx ON chat_sessions(updated_at);
  `);
}

module.exports.ensureTables = ensureTables;
