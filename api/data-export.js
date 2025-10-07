// Use shared database pool
const { getPool } = require('../lib/db');
const pool = getPool();

const handler = async (req, res) => {
  const { debug, limit } = req.query;
  const isDebug = debug === '1';
  
  try {
    console.log('📊 Fetching data from Cloud Run reader...');
    
    // Fetch data from Cloud Run reader service
    const response = await fetch(process.env.DATA_READER_URL, {
      method: 'GET',
      headers: {
        'x-data-key': process.env.DATA_READER_SECRET,
      },
      // Add timeout
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Reader service failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Successfully fetched data from reader service');

    // Apply limit if specified
    if (limit && data.taps) {
      data.taps = data.taps.slice(0, parseInt(limit));
    }

    // Set cache headers for Vercel
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.setHeader('Content-Type', 'application/json');
    
    return res.status(200).json(data);

  } catch (error) {
    console.error('❌ Error fetching data from reader service:', error);
    
    if (isDebug) {
      return res.status(500).json({
        ok: false,
        at: 'data-export',
        code: error.code || 'FETCH_ERROR',
        message: error.message,
        detail: error.detail || null,
        hint: 'check schema/privs'
      });
    } else {
      return res.status(503).json({ 
        error: 'upstream_unavailable'
      });
    }
  }
};

handler.config = { runtime: 'nodejs' };
module.exports = handler;
