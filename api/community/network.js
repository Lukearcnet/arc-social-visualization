// GET /api/community/network?user_id=:id&hours=:hours&mode=:mode
// Network activity endpoint for bar race chart
// Date: 2025-01-15

const { getExport } = require('../../lib/community/exportReader');
const { getDisplayName, userById, buildUserIndex } = require('../../lib/community/names');

// Main handler
const handler = async (req, res) => {
  const startTime = Date.now();
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, hours = 168, mode, debug } = req.query;
  const isDebug = debug === '1';
  const hoursBack = parseInt(hours) || 168;
  
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  if (!mode || !['taps', 'connections'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "taps" or "connections"' });
  }

  try {
    console.log(`🌐 [network] Computing network ${mode} for user ${user_id} over ${hoursBack} hours`);
    
    // Fetch data from Data Reader
    const { taps, users } = await getExport({ req, res, debug: isDebug });
    
    // Build user index and name resolver
    const usersById = buildUserIndex(users || []);
    const nameFor = (id) => getDisplayName(usersById.get(id) || userById(users || [], id));
    
    // Get network members from weekly API
    const networkMembers = await getNetworkMembers(user_id, hoursBack);
    
    if (isDebug) {
      console.log(`🌐 [network] Network members: ${networkMembers.length}`, networkMembers.slice(0, 5));
    }
    
    // Calculate time window
    const now = new Date();
    const windowStart = new Date(now.getTime() - (hoursBack * 60 * 60 * 1000));
    
    // Filter taps within time window
    const windowTaps = taps.filter(tap => {
      const tapTime = new Date(tap.time);
      return tapTime >= windowStart;
    });
    
    if (isDebug) {
      console.log(`🌐 [network] Window taps: ${windowTaps.length} out of ${taps.length} total`);
    }
    
    // Build buckets by hour
    const buckets = new Map();
    const hourMs = 60 * 60 * 1000;
    
    // Create buckets for the full requested time window
    const currentHour = new Date(now);
    currentHour.setUTCHours(currentHour.getUTCHours(), 0, 0, 0);
    
    for (let i = 0; i < hoursBack; i++) {
      const bucketTime = new Date(currentHour.getTime() - (i * hourMs));
      const bucketKey = bucketTime.toISOString();
      buckets.set(bucketKey, {
        ts: bucketKey,
        activity_count: 0,
        unique_people: new Set(),
        participants: new Map() // user_id -> count
      });
    }
    
    // Process taps into buckets based on mode
    let processedTaps = 0;
    let networkTaps = 0;
    
    windowTaps.forEach(tap => {
      const tapTime = new Date(tap.time);
      const bucketTime = new Date(Date.UTC(
        tapTime.getUTCFullYear(),
        tapTime.getUTCMonth(),
        tapTime.getUTCDate(),
        tapTime.getUTCHours()
      ));
      
      const bucketKey = bucketTime.toISOString();
      if (buckets.has(bucketKey)) {
        const bucket = buckets.get(bucketKey);
        const id1 = tap.user1_id || tap.id1;
        const id2 = tap.user2_id || tap.id2;
        
        // Check if both participants are network members
        if (id1 && id2 && id1 !== id2 && 
            networkMembers.includes(id1) && networkMembers.includes(id2)) {
          
          bucket.activity_count++;
          networkTaps++;
          
          if (mode === 'taps') {
            // Count taps for both participants
            bucket.participants.set(id1, (bucket.participants.get(id1) || 0) + 1);
            bucket.participants.set(id2, (bucket.participants.get(id2) || 0) + 1);
          } else if (mode === 'connections') {
            // Track unique counterparts per user for this bucket
            if (!bucket.counterparts) {
              bucket.counterparts = new Map(); // user_id -> Set of counterpart IDs for this bucket
            }
            
            // Add counterpart to each user's set for this bucket
            if (!bucket.counterparts.has(id1)) {
              bucket.counterparts.set(id1, new Set());
            }
            if (!bucket.counterparts.has(id2)) {
              bucket.counterparts.set(id2, new Set());
            }
            
            bucket.counterparts.get(id1).add(id2);
            bucket.counterparts.get(id2).add(id1);
          }
          
          bucket.unique_people.add(id1);
          bucket.unique_people.add(id2);
        }
        
        processedTaps++;
      }
    });
    
    // For connections mode, convert counterpart sets to counts
    let totalUniqueConnections = 0;
    if (mode === 'connections') {
      // Convert counterpart sets to participant counts for each bucket
      buckets.forEach(bucket => {
        if (bucket.counterparts) {
          bucket.participants = new Map();
          bucket.counterparts.forEach((counterpartSet, userId) => {
            bucket.participants.set(userId, counterpartSet.size);
          });
        }
      });
      
      // Calculate total unique connections across all buckets
      const globalCounterparts = new Map();
      buckets.forEach(bucket => {
        if (bucket.counterparts) {
          bucket.counterparts.forEach((counterpartSet, userId) => {
            if (!globalCounterparts.has(userId)) {
              globalCounterparts.set(userId, new Set());
            }
            counterpartSet.forEach(counterpartId => {
              globalCounterparts.get(userId).add(counterpartId);
            });
          });
        }
      });
      
      totalUniqueConnections = Array.from(globalCounterparts.values())
        .reduce((sum, set) => sum + set.size, 0);
    }
    
    if (isDebug) {
      console.log(`🌐 [network] Processed ${processedTaps} taps, ${networkTaps} network taps`);
      if (mode === 'connections') {
        console.log(`🌐 [Network Connections] bucketCount: ${buckets.size}, uniqueConnections: ${totalUniqueConnections}`);
      }
    }
    
    // Build name map from available sources
    const nameMap = {};
    networkMembers.forEach(id => {
      const name = nameFor(id);
      if (name && name !== 'Unknown') {
        nameMap[id] = name;
      }
    });
    
    // Convert buckets to array and sort by timestamp
    const bucketsArray = Array.from(buckets.values())
      .map(bucket => {
        const participants = Array.from(bucket.participants.entries())
          .map(([userId, count]) => ({
            user_id: userId,
            name: nameFor(userId),
            count: count
          }))
          .sort((a, b) => b.count - a.count);
        
        return {
          ts: bucket.ts,
          activity_count: bucket.activity_count,
          unique_people: bucket.unique_people.size,
          participants: participants
        };
      })
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));
    
    const response = {
      source: 'reader',
      buckets: bucketsArray,
      meta: {
        duration_ms: Date.now() - startTime,
        name_map: nameMap,
        network_members: networkMembers.length,
        total_network_taps: networkTaps,
        total_unique_connections: totalUniqueConnections
      }
    };
    
    if (isDebug) {
      response.meta.debug = {
        network_members: networkMembers.length,
        total_taps: windowTaps.length,
        network_taps: networkTaps,
        buckets_created: bucketsArray.length,
        name_map_size: Object.keys(nameMap).length
      };
    }
    
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('❌ [network] Network calculation failed:', error);
    return res.status(500).json({ 
      error: 'Network calculation failed',
      message: error.message 
    });
  }
};

// Helper function to get network members from weekly API
async function getNetworkMembers(userId, hours) {
  try {
    // Convert hours to time window format
    const timeWindowMap = {
      24: '1d',
      168: '7d', 
      720: '30d',
      4320: '180d',
      8760: '365d'
    };
    const timeWindow = timeWindowMap[hours] || '7d';
    
    // Fetch weekly data to get network members
    const weeklyResponse = await fetch(`${process.env.DATA_READER_URL}/data-export`, {
      method: 'GET',
      headers: {
        'x-data-key': process.env.DATA_READER_SECRET,
        'Content-Type': 'application/json'
      }
    });
    
    if (!weeklyResponse.ok) {
      throw new Error(`Weekly API failed: ${weeklyResponse.status}`);
    }
    
    const exportData = await weeklyResponse.json();
    const { assembleWeeklyFromExport } = require('../../lib/weekly/assembleFromExport');
    
    // Build user index for name resolution
    const usersById = buildUserIndex(exportData.users || []);
    const nameFor = (id) => getDisplayName(usersById.get(id) || userById(exportData.users || [], id));
    
    // Assemble weekly data to get network members
    const weeklyData = assembleWeeklyFromExport({
      userId: userId,
      taps: exportData.taps || [],
      users: exportData.users || [],
      nowUtc: new Date().toISOString(),
      timeWindow: timeWindow,
      isDebug: false
    });
    
    // Build network members set (1st/2nd/3rd degree + logged-in user)
    const networkMembers = new Set();
    networkMembers.add(userId); // Include logged-in user
    
    // Add 1st degree connections
    if (weeklyData.recap?.first_degree_new) {
      weeklyData.recap.first_degree_new.forEach(conn => networkMembers.add(conn.user_id));
    }
    
    // Add 2nd degree connections
    if (weeklyData.recap?.second_degree_new) {
      weeklyData.recap.second_degree_new.forEach(conn => networkMembers.add(conn.user_id));
    }
    
    // Add 3rd degree connections
    if (weeklyData.recap?.third_degree_new) {
      weeklyData.recap.third_degree_new.forEach(conn => networkMembers.add(conn.user_id));
    }
    
    return Array.from(networkMembers);
    
  } catch (error) {
    console.error('❌ [network] Failed to get network members:', error);
    // Fallback to just the logged-in user
    return [userId];
  }
}

module.exports = handler;
