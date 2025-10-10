// GET /api/community/radar?user_id=:id&hours=24
// Opportunity Radar endpoint for Community page
// Date: 2025-01-15

const { getExport } = require('../../lib/community/exportReader');
const { getDisplayName, userById } = require('../../lib/community/names');

// Main handler
const handler = async (req, res) => {
  const startTime = Date.now();
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, hours = 24, debug } = req.query;
  const isDebug = debug === '1';
  const hoursBack = parseInt(hours) || 24;
  
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    console.log('📡 [radar] Computing activity radar...');
    
    // Fetch data from Data Reader
    const { taps, users } = await getExport({ req, res, debug: isDebug });
    
    // Calculate time window
    const now = new Date();
    const windowStart = new Date(now.getTime() - (hoursBack * 60 * 60 * 1000));
    
    // Filter taps where user participated within the time window
    const userTaps = taps.filter(tap => {
      const tapTime = new Date(tap.time);
      const id1 = tap.user1_id || tap.id1;
      const id2 = tap.user2_id || tap.id2;
      return (id1 === user_id || id2 === user_id) && tapTime >= windowStart;
    });
    
    // Bucket by hour
    const buckets = new Map();
    const hourMs = 60 * 60 * 1000;
    
    // Find actual time range of userTaps to create proper buckets
    const tapTimes = userTaps.map(tap => new Date(tap.time));
    const minTime = new Date(Math.min(...tapTimes));
    const maxTime = new Date(Math.max(...tapTimes));
    
    // Create buckets for the actual data range, not just going backwards from now
    const startHour = new Date(Date.UTC(
      minTime.getUTCFullYear(),
      minTime.getUTCMonth(),
      minTime.getUTCDate(),
      minTime.getUTCHours()
    ));
    
    const endHour = new Date(Date.UTC(
      maxTime.getUTCFullYear(),
      maxTime.getUTCMonth(),
      maxTime.getUTCDate(),
      maxTime.getUTCHours()
    ));
    
    // Generate buckets for every hour in the data range
    const currentHour = new Date(startHour);
    while (currentHour <= endHour) {
      const bucketKey = currentHour.toISOString();
      buckets.set(bucketKey, {
        ts: bucketKey,
        activity_count: 0,
        unique_people: new Set()
      });
      
      // Move to next hour
      currentHour.setUTCHours(currentHour.getUTCHours() + 1);
    }
    
    if (isDebug) {
      console.log('📡 [radar] Created buckets for time range:', {
        startHour: startHour.toISOString(),
        endHour: endHour.toISOString(),
        totalBuckets: buckets.size,
        userTapsCount: userTaps.length
      });
    }
    
    // Process taps into buckets
    let processedTaps = 0;
    let ignoredTaps = 0;
    
    userTaps.forEach(tap => {
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
        bucket.activity_count++;
        processedTaps++;
        
        const id1 = tap.user1_id || tap.id1;
        const id2 = tap.user2_id || tap.id2;
        const otherId = id1 === user_id ? id2 : id1;
        if (otherId && otherId !== user_id) {
          bucket.unique_people.add(otherId);
          // Track participant counts for bar race
          bucket.participants = bucket.participants || new Map();
          bucket.participants.set(otherId, (bucket.participants.get(otherId) || 0) + 1);
        }
      } else {
        ignoredTaps++;
        if (isDebug && ignoredTaps <= 5) {
          console.log('📡 [radar] Ignored tap - no matching bucket:', {
            tapTime: tap.time,
            bucketKey: bucketKey,
            availableBuckets: Array.from(buckets.keys()).slice(0, 3)
          });
        }
      }
    });
    
    if (isDebug) {
      console.log('📡 [radar] Tap processing results:', {
        totalUserTaps: userTaps.length,
        processedTaps: processedTaps,
        ignoredTaps: ignoredTaps,
        processingRate: `${Math.round((processedTaps / userTaps.length) * 100)}%`
      });
    }
    
    // Convert buckets to array and sort by timestamp
    const bucketsArray = Array.from(buckets.values())
      .map(bucket => {
        const participants = bucket.participants ? 
          Array.from(bucket.participants.entries())
            .map(([userId, count]) => {
              const user = userById(users, userId);
              return {
                user_id: userId,
                name: getDisplayName(user),
                count: count
              };
            })
            .sort((a, b) => b.count - a.count) : [];
        
        return {
          ts: bucket.ts,
          activity_count: bucket.activity_count,
          unique_people: bucket.unique_people.size,
          participants: participants
        };
      })
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));
    
    // Get top current window (last hour) counterparties
    const lastHour = new Date(now.getTime() - hourMs);
    const currentWindowTaps = userTaps.filter(tap => {
      const tapTime = new Date(tap.time);
      return tapTime >= lastHour;
    });
    
    const currentWindowCounts = new Map();
    currentWindowTaps.forEach(tap => {
      const id1 = tap.user1_id || tap.id1;
      const id2 = tap.user2_id || tap.id2;
      const otherId = id1 === user_id ? id2 : id1;
      if (otherId && otherId !== user_id) {
        currentWindowCounts.set(otherId, (currentWindowCounts.get(otherId) || 0) + 1);
      }
    });
    
    const topCurrentWindow = Array.from(currentWindowCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([userId, count]) => {
        const user = userById(users, userId);
        return {
          user_id: userId,
          name: getDisplayName(user),
          count: count
        };
      });
    
    const response = {
      source: 'reader',
      user_id: user_id,
      window: {
        hours: hoursBack,
        end: now.toISOString()
      },
      buckets: bucketsArray,
      top_current_window: topCurrentWindow,
      meta: {
        duration_ms: Date.now() - startTime
      }
    };
    
    if (isDebug) {
      response.meta.debug = {
        total_taps: userTaps.length,
        processed_taps: processedTaps,
        ignored_taps: ignoredTaps,
        processing_rate: `${Math.round((processedTaps / userTaps.length) * 100)}%`,
        buckets_processed: bucketsArray.length,
        current_window_taps: currentWindowTaps.length,
        unique_people_total: new Set(userTaps.map(tap => {
          const id1 = tap.user1_id || tap.id1;
          const id2 = tap.user2_id || tap.id2;
          return id1 === user_id ? id2 : id1;
        }).filter(Boolean)).size,
        time_range: {
          start: startHour.toISOString(),
          end: endHour.toISOString(),
          hours_covered: buckets.size
        }
      };
    }
    
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('❌ [radar] Radar calculation failed:', error);
    
    if (isDebug) {
      return res.status(500).json({
        ok: false,
        at: 'radar:calculation',
        code: error.code || 'RADAR_ERROR',
        message: error.message,
        detail: error.detail || null
      });
    } else {
      return res.status(500).json({ 
        error: 'radar_calculation_failed',
        message: 'Failed to calculate activity radar'
      });
    }
  }
};

handler.config = { runtime: 'nodejs' };
module.exports = handler;
