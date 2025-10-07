import { Pool } from 'pg';

// Shared database pool for all API routes
// Uses exact same pattern as working data-export.js
// Strip SSL parameters from connection string to avoid file path issues
const connectionString = process.env.DATABASE_URL.split('?')[0];
const pool = global._arcPool || new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false }
});

if (!global._arcPool) global._arcPool = pool;

export default pool;
