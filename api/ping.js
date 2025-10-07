const handler = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({ ok: true, timestamp: new Date().toISOString() });
};

handler.config = { runtime: 'nodejs' };
module.exports = handler;
