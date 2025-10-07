// GET /api/community/health
// Health check endpoint for Community API database connectivity
// Date: 2025-01-15

// Force Node.js runtime (not Edge) - Edge cannot use pg
module.exports.config = { runtime: 'nodejs' };

// Use shared database pool
const { getPool } = require('../../lib/db');
const pool = getPool();

module.exports = async (req, res) => {
  console.log('🏥 COMMUNITY HEALTH CHECK');
  console.log('🔍 DATABASE_URL present:', !!process.env.DATABASE_URL);
  console.log('🔍 DATABASE_URL starts with postgres:', process.env.DATABASE_URL?.startsWith('postgres'));
  console.log('🔍 Pool exists:', !!pool);
  console.log('🔍 Pool totalCount:', pool?.totalCount);
  console.log('🔍 Pool idleCount:', pool?.idleCount);
  console.log('🔍 Pool waitingCount:', pool?.waitingCount);
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔌 Attempting to connect to database...');
    const startTime = Date.now();
    const client = await pool.connect();
    const connectTime = Date.now() - startTime;
    console.log(`✅ Database connection established in ${connectTime}ms`);
    console.log('🔍 Client process ID:', client?.processID);
    console.log('🔍 Client secret key:', client?.secretKey);
    
    try {
      // Single diagnostic query to fix current_database() bug
      console.log('🔍 Running diagnostic query...');
      const queryStartTime = Date.now();
      const diagResult = await client.query(`
        SELECT 
          current_database() AS db,
          current_user       AS user,
          inet_server_addr()::text AS host,
          inet_server_port() AS port,
          NOW()              AS now
      `);
      const queryTime = Date.now() - queryStartTime;
      console.log(`✅ Diagnostic query completed in ${queryTime}ms`);
      console.log('🔍 Query result:', diagResult.rows[0]);
      
      // Check table existence
      console.log('🔍 Checking table existence...');
      const tableStartTime = Date.now();
      const tableResult = await client.query(`
        SELECT 
          to_regclass('public.taps')                                  AS has_taps,
          to_regclass('public.users')                                 AS has_users,
          to_regclass('gamification.user_week_activity')              AS has_user_week_activity,
          to_regclass('gamification.edge_strength')                   AS has_edge_strength
      `);
      const tableTime = Date.now() - tableStartTime;
      console.log(`✅ Table check completed in ${tableTime}ms`);
      console.log('🔍 Table results:', tableResult.rows[0]);
      
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
    console.error('❌ [community/health] FULL ERROR STACK:');
    console.error('❌ Error name:', err.name);
    console.error('❌ Error message:', err.message);
    console.error('❌ Error code:', err.code);
    console.error('❌ Error detail:', err.detail);
    console.error('❌ Error hint:', err.hint);
    console.error('❌ Error position:', err.position);
    console.error('❌ Error internalPosition:', err.internalPosition);
    console.error('❌ Error internalQuery:', err.internalQuery);
    console.error('❌ Error where:', err.where);
    console.error('❌ Error schema:', err.schema);
    console.error('❌ Error table:', err.table);
    console.error('❌ Error column:', err.column);
    console.error('❌ Error dataType:', err.dataType);
    console.error('❌ Error constraint:', err.constraint);
    console.error('❌ Error file:', err.file);
    console.error('❌ Error line:', err.line);
    console.error('❌ Error routine:', err.routine);
    console.error('❌ Error severity:', err.severity);
    console.error('❌ Error stack:', err.stack);
    console.error('❌ Full error object:', JSON.stringify(err, null, 2));
    
    return res.status(500).json({
      ok: false,
      code: err.code,
      message: err.message,
      detail: err.detail || null,
      name: err.name,
      severity: err.severity
    });
  }
};
