export default async function handler(req, res) {
  // Auth guard - only allow requests with the correct secret
  if (req.headers['x-refresh-secret'] !== process.env.REFRESH_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    console.log('🔄 Vercel Cron Job triggered: Calling local webhook at', new Date().toISOString());

    // Call your local webhook server
    const webhookUrl = process.env.LOCAL_WEBHOOK_URL || 'http://localhost:8080/webhook';
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': process.env.REFRESH_SECRET
      },
      body: JSON.stringify({
        trigger: 'vercel-cron',
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      throw new Error(`Webhook call failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log('✅ Local webhook response:', result);

    return res.status(200).json({ 
      ok: true, 
      message: 'Cron job triggered local data refresh',
      timestamp: new Date().toISOString(),
      webhook_result: result
    });

  } catch (error) {
    console.error('❌ Vercel Cron Job failed:', error);
    return res.status(500).json({ 
      error: 'refresh_failed', 
      detail: error.message 
    });
  }
}
