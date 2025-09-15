import { get } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    console.log('📊 Fetching data from Vercel Blob...');
    
    // Get the data from Vercel Blob
    const dataBlob = await get('comprehensive_data.json');
    const data = JSON.parse(await dataBlob.text());
    
    console.log(`✅ Data fetched: ${data.taps?.length || 0} taps, ${data.users?.length || 0} users`);
    
    // Set cache headers for better performance
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300'); // 5 minutes cache
    res.setHeader('Content-Type', 'application/json');
    
    return res.status(200).json(data);

  } catch (error) {
    console.error('❌ Failed to fetch data:', error);
    
    // Return empty data structure if blob doesn't exist yet
    if (error.message.includes('not found')) {
      return res.status(200).json({
        taps: [],
        users: [],
        last_updated: new Date().toISOString(),
        message: 'No data available yet'
      });
    }
    
    return res.status(500).json({ 
      error: 'data_fetch_failed', 
      detail: error.message 
    });
  }
}
