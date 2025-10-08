// GET /api/community/health?user_id=:id
// Relationship Health endpoint for Community page
// Date: 2025-01-15

const { getExport } = require('../../lib/community/exportReader');
const { getDisplayName, userById, buildUserIndex } = require('../../lib/community/names');

// Main handler
const handler = async (req, res) => {
  const startTime = Date.now();
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, debug } = req.query;
  const isDebug = debug === '1';
  
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    console.log('🏥 [health] Computing relationship health...');
    
    // Fetch data from Data Reader
    const { taps, users } = await getExport({ req, res, debug: isDebug });
    
    // Build user index and name resolver
    const usersArray = users || [];
    const usersById = buildUserIndex(usersArray);
    const nameFor = (id) => getDisplayName(usersById.get(id) || userById(usersArray, id));
    
    // Filter taps where user participated in last 90 days
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
    
    const userTaps = taps.filter(tap => {
      const tapTime = new Date(tap.time);
      const id1 = tap.user1_id || tap.id1;
      const id2 = tap.user2_id || tap.id2;
      return (id1 === user_id || id2 === user_id) && tapTime >= ninetyDaysAgo;
    });
    
    // Build pairwise counts
    const connectionCounts = new Map();
    
    userTaps.forEach(tap => {
      const id1 = tap.user1_id || tap.id1;
      const id2 = tap.user2_id || tap.id2;
      const otherId = id1 === user_id ? id2 : id1;
      
      if (otherId && otherId !== user_id) {
        if (!connectionCounts.has(otherId)) {
          connectionCounts.set(otherId, {
            taps_7d: 0,
            taps_30d: 0,
            taps_90d: 0,
            last_tap_at: null
          });
        }
        
        const counts = connectionCounts.get(otherId);
        const tapTime = new Date(tap.time);
        
        // Count taps in different time windows
        if (tapTime >= new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000))) {
          counts.taps_7d++;
        }
        if (tapTime >= new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000))) {
          counts.taps_30d++;
        }
        counts.taps_90d++;
        
        // Track most recent tap
        if (!counts.last_tap_at || tapTime > new Date(counts.last_tap_at)) {
          counts.last_tap_at = tap.time;
        }
      }
    });
    
    // Calculate health metrics for each connection
    const connections = Array.from(connectionCounts.entries()).map(([otherUserId, counts]) => {
      const daysSinceLastTap = counts.last_tap_at 
        ? Math.ceil((now - new Date(counts.last_tap_at)) / (24 * 60 * 60 * 1000))
        : 999;
      
      // Calculate strength: 0.5*(taps_30d/10) + 0.3*(taps_90d/30) + 0.2*(1/(1+days_since_last_tap))
      const strength_f32 = Math.min(1, Math.max(0, 
        0.5 * (counts.taps_30d / 10) + 
        0.3 * (counts.taps_90d / 30) + 
        0.2 * (1 / (1 + daysSinceLastTap))
      ));
      
      // Determine health bucket
      let health;
      if (strength_f32 >= 0.8) health = 'excellent';
      else if (strength_f32 >= 0.6) health = 'good';
      else if (strength_f32 >= 0.4) health = 'fair';
      else health = 'needs_attention';
      
      return {
        other_user_id: otherUserId,
        name: nameFor(otherUserId),
        strength_f32: Math.round(strength_f32 * 100) / 100,
        taps_7d: counts.taps_7d,
        taps_30d: counts.taps_30d,
        taps_90d: counts.taps_90d,
        days_since_last_tap: daysSinceLastTap,
        health: health
      };
    });
    
    // Sort by strength and take top 15
    const topConnections = connections
      .sort((a, b) => b.strength_f32 - a.strength_f32)
      .slice(0, 15);
    
    // Calculate summary statistics
    const healthBuckets = {
      excellent: 0,
      good: 0,
      fair: 0,
      needs_attention: 0
    };
    
    topConnections.forEach(conn => {
      healthBuckets[conn.health]++;
    });
    
    const avgStrength = topConnections.length > 0 
      ? topConnections.reduce((sum, conn) => sum + conn.strength_f32, 0) / topConnections.length
      : 0;
    
    const response = {
      source: 'reader',
      user_id: user_id,
      as_of: now.toISOString(),
      summary: {
        avg_strength: Math.round(avgStrength * 100) / 100,
        excellent: healthBuckets.excellent,
        good: healthBuckets.good,
        fair: healthBuckets.fair,
        needs_attention: healthBuckets.needs_attention
      },
      connections: topConnections,
      meta: {
        duration_ms: Date.now() - startTime,
        warnings: []
      }
    };
    
    if (isDebug) {
      response.meta.debug = {
        total_connections: connections.length,
        taps_processed: userTaps.length,
        time_window_days: 90,
        names_resolved: usersArray.length,
        users_len: usersArray.length,
        has_index: usersById instanceof Map
      };
    }
    
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('❌ [health] Relationship health calculation failed:', error);
    
    if (isDebug) {
      return res.status(500).json({
        ok: false,
        at: 'health:calculation',
        code: error.code || 'HEALTH_ERROR',
        message: error.message,
        detail: error.detail || null
      });
    } else {
      return res.status(500).json({ 
        error: 'health_calculation_failed',
        message: 'Failed to calculate relationship health'
      });
    }
  }
};

handler.config = { runtime: 'nodejs' };
module.exports = handler;