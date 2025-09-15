import { put, get } from '@vercel/blob';

export default async function handler(req, res) {
  // Auth guard - only allow requests with the correct secret
  if (req.headers['x-refresh-secret'] !== process.env.REFRESH_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    console.log('🔄 Vercel Cron Job triggered: Starting data refresh at', new Date().toISOString());
    
    // Import the data export functionality
    const { refreshData } = await import('./data-export.js');
    
    // Run the data refresh
    const result = await refreshData();
    
    console.log('✅ Data refresh completed:', result);

    return res.status(200).json({ 
      ok: true, 
      message: 'Data refresh completed successfully',
      timestamp: new Date().toISOString(),
      result: result
    });

  } catch (error) {
    console.error('❌ Data refresh failed:', error);
    return res.status(500).json({ 
      error: 'refresh_failed', 
      detail: error.message 
    });
  }
}