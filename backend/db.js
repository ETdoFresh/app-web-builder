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
