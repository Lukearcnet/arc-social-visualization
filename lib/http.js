// lib/http.js
// Smart proxy helper for Vercel API routes
// Date: 2025-01-15

/**
 * Smart proxy that uses DATA_READER_URL if available, otherwise falls back to local function
 * @param {Function} localFn - Local function to execute if DATA_READER_URL is not set
 * @param {string} path - API path to call on the reader service (e.g., '/community/weekly')
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
async function proxyOr(localFn, path, req, res) {
  const startTime = Date.now();
  
  // Check if DATA_READER_URL is available
  if (process.env.DATA_READER_URL) {
    try {
      console.log(`🔄 [proxy] Using reader service: ${process.env.DATA_READER_URL}${path}`);
      
      // Build URL with query parameters
      const url = new URL(`${process.env.DATA_READER_URL}${path}`);
      Object.keys(req.query).forEach(key => {
        url.searchParams.set(key, req.query[key]);
      });
      
      // Make request to reader service
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'x-data-key': process.env.DATA_READER_SECRET || '',
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // Forward the response
      const data = await response.json();
      
      // Set response headers
      res.status(response.status);
      res.setHeader('Content-Type', 'application/json');
      if (response.headers.get('Cache-Control')) {
        res.setHeader('Cache-Control', response.headers.get('Cache-Control'));
      }
      
      const duration = Date.now() - startTime;
      console.log(`✅ [proxy] Reader response: ${response.status} (${duration}ms)`);
      
      return res.json(data);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [proxy] Reader service failed: ${error.message} (${duration}ms)`);
      
      // Fall back to local function on reader failure
      console.log(`🔄 [proxy] Falling back to direct DB access`);
      return await localFn(req, res);
    }
  } else {
    // No DATA_READER_URL, use local function
    console.log(`🔄 [proxy] Using direct DB access (no DATA_READER_URL)`);
    return await localFn(req, res);
  }
}

module.exports = { proxyOr };
