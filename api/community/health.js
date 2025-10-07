// GET /api/community/health
// Health check endpoint for Community API database connectivity
// Date: 2025-01-15

// Force Node.js runtime (not Edge) - Edge cannot use pg
export const config = { runtime: 'nodejs' };

// Use shared database pool
import pool from '../../lib/db.js';

export default async function handler(req, res) {
  console.log('🏥 COMMUNITY HEALTH CHECK');
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const client = await pool.connect();
    
    try {
      // Rich diagnostics
      const nowResult = await client.query('SELECT NOW() AS now');
      const whoResult = await client.query('SELECT current_user, current_database()');
      const ipResult = await client.query('SELECT inet_server_addr() AS db_ip');
      const schemasResult = await client.query(`
        SELECT nspname FROM pg_namespace WHERE nspname IN ('public','gamification')
      `);
      
      // Check gamification table counts
      const dayResult = await client.query('SELECT COUNT(*) AS day_rows FROM gamification.user_day_activity');
      const weekResult = await client.query('SELECT COUNT(*) AS week_rows FROM gamification.user_week_activity');
      const edgesResult = await client.query('SELECT COUNT(*) AS edges FROM gamification.edge_strength');
      
      const healthData = {
        ok: true,
        now: nowResult.rows[0].now,
        whoami: {
          user: whoResult.rows[0].current_user,
          database: whoResult.rows[0].current_database()
        },
        db_ip: ipResult.rows[0].db_ip,
        schemas: schemasResult.rows.map(r => r.nspname),
        counts: {
          day_rows: Number(dayResult.rows[0].day_rows),
          week_rows: Number(weekResult.rows[0].week_rows),
          edges: Number(edgesResult.rows[0].edges)
        }
      };
      
      console.log('✅ Community health check passed:', healthData);
      return res.status(200).json(healthData);
      
    } finally {
      client.release();
    }
    
  } catch (err) {
    console.error('[community/health]', err.stack || err.message, { code: err.code });
    return res.status(500).json({
      ok: false,
      code: err.code,
      error: String(err.message),
      hint: 'DATABASE_URL/SSL/permissions'
    });
  }
}
