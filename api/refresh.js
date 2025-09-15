import { handleDataExport } from './data-export.js';

// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';

export default async function handler(req, res) {
  // Auth guard - only allow requests with the correct secret
  if (req.headers['x-refresh-secret'] !== process.env.REFRESH_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    console.log('🔄 Vercel Cron Job triggered: Starting data refresh at', new Date().toISOString());

    // Perform data export
    const exportedData = await handleDataExport();

    // For now, we'll just log success. In a real implementation, you might:
    // - Store data in a file system
    // - Send to another service
    // - Update a cache
    console.log('✅ Data refresh complete. Processed', exportedData.taps?.length || 0, 'taps');

    return res.status(200).json({
      ok: true,
      message: 'Cron job triggered cloud data refresh',
      timestamp: new Date().toISOString(),
      taps_processed: exportedData.taps?.length || 0,
      users_processed: exportedData.users?.length || 0,
    });

  } catch (error) {
    console.error('❌ Vercel Cron Job failed:', error);
    return res.status(500).json({
      error: 'refresh_failed',
      detail: error.message,
    });
  }
}
