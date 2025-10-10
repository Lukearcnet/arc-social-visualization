// GET /api/users?ids=id1,id2,id3
// Bulk users endpoint for name resolution
// Date: 2025-01-15

const { getExport } = require('../lib/community/exportReader');
const { getDisplayName, userById, buildUserIndex } = require('../lib/community/names');

// Main handler
const handler = async (req, res) => {
  const startTime = Date.now();
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ids, debug } = req.query;
  const isDebug = debug === '1';
  
  if (!ids) {
    return res.status(400).json({ error: 'ids parameter is required' });
  }

  try {
    console.log('👥 [users] Fetching bulk users for IDs:', ids);
    
    // Parse comma-separated IDs
    const userIds = ids.split(',').map(id => id.trim()).filter(Boolean);
    
    if (userIds.length === 0) {
      return res.status(400).json({ error: 'No valid IDs provided' });
    }
    
    if (userIds.length > 100) {
      return res.status(400).json({ error: 'Too many IDs (max 100)' });
    }
    
    // Fetch data from Data Reader
    const { users } = await getExport({ req, res, debug: isDebug });
    
    // Build user index for efficient lookups
    const usersById = buildUserIndex(users || []);
    
    // Find users by IDs
    const foundUsers = [];
    const missingIds = [];
    
    userIds.forEach(id => {
      const user = usersById.get(id) || userById(users || [], id);
      if (user) {
        // Extract name using the same logic as other endpoints
        const name = getDisplayName(user);
        foundUsers.push({
          id: id,
          user_id: id,
          name: name,
          user_name: user.user_name || user.username,
          display_name: user.display_name,
          first_name: user.first_name,
          last_name: user.last_name
        });
      } else {
        missingIds.push(id);
      }
    });
    
    if (isDebug) {
      console.log(`👥 [users] Found ${foundUsers.length} users, missing ${missingIds.length} IDs`);
      if (missingIds.length > 0) {
        console.log('👥 [users] Missing IDs:', missingIds.slice(0, 5));
      }
    }
    
    const response = {
      source: 'reader',
      users: foundUsers,
      meta: {
        duration_ms: Date.now() - startTime,
        requested: userIds.length,
        found: foundUsers.length,
        missing: missingIds.length
      }
    };
    
    if (isDebug) {
      response.meta.debug = {
        missing_ids: missingIds,
        sample_users: foundUsers.slice(0, 3)
      };
    }
    
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('❌ [users] Bulk users fetch failed:', error);
    return res.status(500).json({ 
      error: 'Bulk users fetch failed',
      message: error.message 
    });
  }
};

module.exports = handler;
