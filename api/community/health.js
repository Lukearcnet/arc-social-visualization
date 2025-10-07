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
      // Single diagnostic query to fix current_database() bug
      const diagResult = await client.query(`
        SELECT 
          current_database() AS db,
          current_user       AS user,
          inet_server_addr()::text AS host,
          inet_server_port() AS port,
          NOW()              AS now
      `);
      
      // Check table existence
      const tableResult = await client.query(`
        SELECT 
          to_regclass('public.taps')                                  AS has_taps,
          to_regclass('public.users')                                 AS has_users,
          to_regclass('gamification.user_week_activity')              AS has_user_week_activity,
          to_regclass('gamification.edge_strength')                   AS has_edge_strength
      `);
      
      const healthData = {
        ok: true,
        db: diagResult.rows[0].db,
        user: diagResult.rows[0].user,
        host: diagResult.rows[0].host,
        port: diagResult.rows[0].port,
        now: diagResult.rows[0].now,
        has: {
          taps: tableResult.rows[0].has_taps,
          users: tableResult.rows[0].has_users,
          user_week_activity: tableResult.rows[0].has_user_week_activity,
          edge_strength: tableResult.rows[0].has_edge_strength
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
      message: err.message,
      detail: err.detail || null
    });
  }
}
