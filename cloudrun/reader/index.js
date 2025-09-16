const { Storage } = require('@google-cloud/storage');

const storage = new Storage();
const bucketName = 'arc-data-arcsocial';
const fileName = 'visualization/latest.json';

const DATA_READER_SECRET = process.env.DATA_READER_SECRET;

if (!DATA_READER_SECRET) {
  console.error('❌ DATA_READER_SECRET environment variable is required');
  process.exit(1);
}

const server = require('http').createServer(async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-data-key');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Check authorization
  const dataKey = req.headers['x-data-key'];
  if (dataKey !== DATA_READER_SECRET) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  try {
    console.log('📊 Reading data from GCS...');
    
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(fileName);
    
    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      console.error('❌ File not found in GCS:', fileName);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream_error' }));
      return;
    }

    // Stream the file content
    res.writeHead(200, { 'Content-Type': 'application/json' });
    
    const stream = file.createReadStream();
    stream.pipe(res);
    
    stream.on('error', (error) => {
      console.error('❌ Error streaming file:', error);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'upstream_error' }));
      }
    });

    console.log('✅ Successfully streamed data from GCS');

  } catch (error) {
    console.error('❌ Error reading from GCS:', error);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream_error' }));
  }
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`🚀 ARC Data Reader service running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
