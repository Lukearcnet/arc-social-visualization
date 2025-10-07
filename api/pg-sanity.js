// Use shared database pool
const { getPool } = require('../lib/db');
const pool = getPool();

const handler = async (req, res) => {
  try {
    console.log('🔍 Testing database connection...');
    
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT 1 as test, NOW() as timestamp');
      console.log('✅ Database connection successful');
      
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json({
        ok: true,
        database: 'connected',
        test: result.rows[0].test,
        timestamp: result.rows[0].timestamp
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({
      ok: false,
      database: 'failed',
      error: error.message,
      code: error.code
    });
  }
};

handler.config = { runtime: 'nodejs' };
module.exports = handler;
