const { Client } = require('pg');

export default async function handler(req, res) {
  // Auth guard - only allow requests with the correct secret
  if (req.headers['x-refresh-secret'] !== process.env.REFRESH_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    console.log('🔄 Vercel Cron Job triggered: Data refresh initiated at', new Date().toISOString());

    // Connect to PostgreSQL database
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
    });
    
    await client.connect();
    console.log('✅ Connected to PostgreSQL database');

    // Get current tap count
    const result = await client.query('SELECT COUNT(*) as tap_count FROM taps');
    const tapCount = result.rows[0].tap_count;
    
    console.log(`📊 Current tap count in database: ${tapCount}`);
    
    await client.end();
    console.log('✅ Database connection closed');

    // Return success response
    return res.status(200).json({ 
      ok: true, 
      message: 'Database connection successful!',
      timestamp: new Date().toISOString(),
      tapCount: tapCount,
      next_step: 'Ready to implement full data refresh logic'
    });

  } catch (error) {
    console.error('❌ Vercel Cron Job failed:', error);
    return res.status(500).json({ 
      error: 'refresh_failed', 
      detail: error.message 
    });
  }
}
