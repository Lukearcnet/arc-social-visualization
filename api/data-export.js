// GET /api/data-export
// Data export endpoint with smart proxy
// Date: 2025-01-15

// Use shared database pool
const { getPool } = require('../lib/db');
const { proxyOr } = require('../lib/http');
const pool = getPool();

// Local function for direct DB access (fallback)
const localHandler = async (req, res) => {
  const { debug, limit } = req.query;
  const isDebug = debug === '1';
  
  try {
    console.log('📊 [data-export] Using direct DB access (fallback)');
    
    // This is a fallback - in practice, we expect DATA_READER_URL to be set
    // For now, return a simple response indicating the service is unavailable
    return res.status(503).json({ 
      error: 'data_reader_unavailable',
      message: 'DATA_READER_URL not configured - direct DB access not implemented for data-export'
    });

  } catch (error) {
    console.error('❌ [data-export] Direct DB fallback failed:', error);
    
    if (isDebug) {
      return res.status(500).json({
        ok: false,
        at: 'data-export-direct',
        code: error.code || 'FALLBACK_ERROR',
        message: error.message,
        detail: error.detail || null,
        hint: 'DATA_READER_URL required for data-export'
      });
    } else {
      return res.status(503).json({ 
        error: 'service_unavailable'
      });
    }
  }
};

// Main handler that uses smart proxy
const handler = async (req, res) => {
  const startTime = Date.now();
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Use smart proxy: DATA_READER_URL if available, otherwise direct DB
  await proxyOr(localHandler, '/data-export', req, res);
  
  const duration = Date.now() - startTime;
  const mode = process.env.DATA_READER_URL ? 'reader' : 'direct';
  console.log(`📊 [data-export] mode=${mode} duration=${duration}ms`);
};

handler.config = { runtime: 'nodejs' };
module.exports = handler;
