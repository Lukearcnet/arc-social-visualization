// GET /api/community/test
// Simple test endpoint to verify routing works

export default async function handler(req, res) {
  console.log('🧪 Test API handler called');
  
  return res.status(200).json({
    message: 'Test API is working',
    timestamp: new Date().toISOString(),
    method: req.method,
    query: req.query
  });
}
