// GET /api/community/health
// Health check endpoint for Community API database connectivity
// Date: 2025-01-15

// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';

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
      // Test basic connectivity
      const nowResult = await client.query('SELECT NOW() AS now');
      
      // Check gamification table counts
      const dayResult = await client.query('SELECT COUNT(*) AS day_rows FROM gamification.user_day_activity');
      const weekResult = await client.query('SELECT COUNT(*) AS week_rows FROM gamification.user_week_activity');
      const edgesResult = await client.query('SELECT COUNT(*) AS edges FROM gamification.edge_strength');
      
      const healthData = {
        ok: true,
        now: nowResult.rows[0].now,
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
    console.error('[community/health]', err);
    return res.status(500).json({
      ok: false,
      error: String(err.message),
      code: err.code
    });
  }
}
