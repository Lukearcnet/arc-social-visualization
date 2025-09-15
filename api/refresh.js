import { handleDataExport } from './data-export';
import { put } from '@vercel/blob';

export default async function handler(req, res) {
  // Auth guard - only allow requests with the correct secret
  if (req.headers['x-refresh-secret'] !== process.env.REFRESH_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    console.log('🔄 Vercel Cron Job triggered: Starting data refresh at', new Date().toISOString());

    // Perform data export
    const exportedData = await handleDataExport();

    // Store data in Vercel Blob
    const blob = await put('comprehensive_data.json', JSON.stringify(exportedData), {
      access: 'public',
      contentType: 'application/json',
    });

    console.log('✅ Data refresh complete and stored in Vercel Blob:', blob.url);

    return res.status(200).json({
      ok: true,
      message: 'Cron job triggered cloud data refresh',
      timestamp: new Date().toISOString(),
      blob_url: blob.url,
    });

  } catch (error) {
    console.error('❌ Vercel Cron Job failed:', error);
    return res.status(500).json({
      error: 'refresh_failed',
      detail: error.message,
    });
  }
}
