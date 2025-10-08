// lib/community/exportReader.js
// Shared helper for fetching Data Reader export
// Date: 2025-01-15

async function getExport({ req, res, debug }) {
  const DATA_READER_URL = process.env.DATA_READER_URL;
  const DATA_READER_SECRET = process.env.DATA_READER_SECRET;
  
  if (!DATA_READER_URL || !DATA_READER_SECRET) {
    const error = 'DATA_READER_URL and DATA_READER_SECRET must be configured';
    console.error('❌ [exportReader]', error);
    res.status(502).json({ error: 'reader_unavailable', message: error });
    throw new Error(error);
  }
  
  try {
    console.log('📊 [exportReader] Fetching data from Data Reader...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const response = await fetch(`${DATA_READER_URL}/data-export`, {
      method: 'GET',
      headers: {
        'x-data-key': DATA_READER_SECRET,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Data Reader returned ${response.status}: ${response.statusText}`);
    }
    
    const exportData = await response.json();
    
    if (debug) {
      console.log('🔍 [exportReader] Data Reader export keys:', Object.keys(exportData));
      console.log('🔍 [exportReader] Total taps:', exportData.taps?.length || 0);
      console.log('🔍 [exportReader] Total users:', exportData.users?.length || 0);
    }
    
    return {
      taps: exportData.taps || [],
      users: exportData.users || [],
      metadata: exportData.metadata || {}
    };
    
  } catch (error) {
    console.error('❌ [exportReader] Data Reader fetch failed:', error);
    res.status(502).json({ 
      error: 'reader_unavailable',
      message: 'Failed to fetch data from Data Reader'
    });
    throw error;
  }
}

module.exports = { getExport };
