import { Pool } from 'pg';

// Shared database pool for all API routes
// Uses global singleton pattern to prevent multiple pool instances
const pool = global._arcPool || new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 1
});

if (!global._arcPool) global._arcPool = pool;

export default pool;
