const { Pool } = require('pg')

/**
 * Single shared connection pool, built from DATABASE_URL. Never reads or logs
 * the connection string itself — if this throws "DATABASE_URL is not set",
 * the fix is the Codespaces secret, not a code change.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. In Codespaces: Settings -> Secrets and variables -> ' +
    'Codespaces -> New repository secret, then rebuild the Codespace.'
  )
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Neon
})

module.exports = pool
