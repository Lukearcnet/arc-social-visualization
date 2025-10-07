import { Pool } from 'pg';

// Shared database pool for all API routes
// Uses exact same pattern as working data-export.js
// Strip SSL parameters from connection string to avoid file path issues
console.log('🔍 [lib/db] Initializing database pool...');
console.log('🔍 [lib/db] DATABASE_URL present:', !!process.env.DATABASE_URL);
console.log('🔍 [lib/db] DATABASE_URL length:', process.env.DATABASE_URL?.length);
console.log('🔍 [lib/db] DATABASE_URL starts with postgres:', process.env.DATABASE_URL?.startsWith('postgres'));

const connectionString = process.env.DATABASE_URL.split('?')[0];
console.log('🔍 [lib/db] Connection string length:', connectionString?.length);
console.log('🔍 [lib/db] Connection string starts with postgres:', connectionString?.startsWith('postgres'));

const pool = global._arcPool || new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false },
  // Add connection event logging
  onConnect: (client) => {
    console.log('🔌 [lib/db] New connection established');
    console.log('🔍 [lib/db] Client process ID:', client.processID);
  },
  onError: (err, client) => {
    console.error('❌ [lib/db] Pool error:', err);
    console.error('❌ [lib/db] Error details:', {
      name: err.name,
      message: err.message,
      code: err.code,
      stack: err.stack
    });
  }
});

if (!global._arcPool) {
  global._arcPool = pool;
  console.log('🔍 [lib/db] Created new global pool');
} else {
  console.log('🔍 [lib/db] Using existing global pool');
}

console.log('🔍 [lib/db] Pool configuration:', {
  totalCount: pool.totalCount,
  idleCount: pool.idleCount,
  waitingCount: pool.waitingCount
});

export default pool;
