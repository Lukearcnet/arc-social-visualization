// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';

const DATA_READER_URL = process.env.DATA_READER_URL;
const DATA_READER_SECRET = process.env.DATA_READER_SECRET;

export default async function handler(req, res) {
  try {
    console.log('📊 Fetching data from Cloud Run reader...');
    
    // Fetch data from Cloud Run reader service
    const response = await fetch(DATA_READER_URL, {
      method: 'GET',
      headers: {
        'x-data-key': DATA_READER_SECRET,
      },
      // Add timeout
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Reader service failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Successfully fetched data from reader service');

    // Set cache headers for Vercel
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.setHeader('Content-Type', 'application/json');
    
    return res.status(200).json(data);

  } catch (error) {
    console.error('❌ Error fetching data from reader service:', error);
    
    return res.status(503).json({ 
      error: 'upstream_unavailable'
    });
  }
}
