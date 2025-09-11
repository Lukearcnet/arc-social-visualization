const twilio = require('twilio');
const crypto = require('crypto');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function signSession(payload) {
  const val = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'default-secret').update(val).digest('base64url');
  return `${val}.${sig}`;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { phone, code } = req.body || {};
  if (!/^\+\d{10,15}$/.test(phone || '')) return res.status(400).json({ error: 'invalid_phone' });
  if (!/^\d{4,8}$/.test(code || '')) return res.status(400).json({ error: 'invalid_code' });

  try {
    const result = await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
      .verificationChecks.create({ to: phone, code });

    if (result.status === 'approved') {
      const token = signSession({ sub: phone, iat: Date.now(), v: 1 });
      res.setHeader('Set-Cookie', [
        `arc_session=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=1800`
      ]);
      return res.status(200).json({ ok: true });
    }
    return res.status(401).json({ error: 'invalid_or_expired' });
  } catch (e) {
    return res.status(500).json({ error: 'verify_failed' });
  }
};
