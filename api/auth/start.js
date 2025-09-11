const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { phone } = req.body || {};
  if (!/^\+\d{10,15}$/.test(phone || '')) return res.status(400).json({ error: 'invalid_phone' });

  try {
    await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
      .verifications.create({ to: phone, channel: 'sms' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'send_failed' });
  }
};
