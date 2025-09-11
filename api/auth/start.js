const twilio = require('twilio');

// Debug logging
console.log('🔧 DEBUG: Environment variables check:');
console.log('TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? 'SET' : 'NOT SET');
console.log('TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? 'SET' : 'NOT SET');
console.log('TWILIO_VERIFY_SID:', process.env.TWILIO_VERIFY_SID ? 'SET' : 'NOT SET');
console.log('SESSION_SECRET:', process.env.SESSION_SECRET ? 'SET' : 'NOT SET');
console.log('ALLOWED_ORIGINS:', process.env.ALLOWED_ORIGINS ? 'SET' : 'NOT SET');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  console.log('🔧 DEBUG: Function called with method:', req.method);
  
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { phone } = req.body || {};
  console.log('🔧 DEBUG: Phone received:', phone);
  
  if (!/^\+\d{10,15}$/.test(phone || '')) return res.status(400).json({ error: 'invalid_phone' });

  try {
    console.log('🔧 DEBUG: Attempting to send SMS to:', phone);
    await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
      .verifications.create({ to: phone, channel: 'sms' });
    console.log('🔧 DEBUG: SMS sent successfully');
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.log('🔧 DEBUG: Error sending SMS:', e.message);
    return res.status(500).json({ error: 'send_failed' });
  }
};
