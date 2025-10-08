// lib/weekly/assembleFromExport.js
// Weekly payload assembler from Data Reader export
// Date: 2025-01-15

const { getDisplayName, userById, buildUserIndex } = require('../community/names');

// Helper function to build recommendations using mutual connections algorithm
function buildRecommendations(userId, taps, usersById, nameFor) {
  // Normalize taps to { a, b, time } format
  const normalizedTaps = taps.map(tap => {
    const a = tap.user1_id || tap.id1;
    const b = tap.user2_id || tap.id2;
    return { a, b, time: tap.time };
  }).filter(tap => tap.a && tap.b && tap.a !== tap.b); // Skip null/duplicate IDs
  
  // Build direct connections set for userId
  const directConnections = new Set();
  normalizedTaps.forEach(tap => {
    if (tap.a === userId) {
      directConnections.add(tap.b);
    } else if (tap.b === userId) {
      directConnections.add(tap.a);
    }
  });
  
  // Build neighbor map: for each direct connection, find their neighbors
  const neighborMap = new Map();
  directConnections.forEach(directId => {
    const neighbors = new Set();
    normalizedTaps.forEach(tap => {
      if (tap.a === directId && tap.b !== userId) {
        neighbors.add(tap.b);
      } else if (tap.b === directId && tap.a !== userId) {
        neighbors.add(tap.a);
      }
    });
    neighborMap.set(directId, neighbors);
  });
  
  // Find candidates: neighbors-of-neighbors that are not userId and not in direct
  const candidates = new Map(); // candidateId -> { mutualCount, mutualNames }
  
  directConnections.forEach(directId => {
    const neighbors = neighborMap.get(directId);
    if (neighbors) {
      neighbors.forEach(neighborId => {
        // Skip if neighbor is userId or already a direct connection
        if (neighborId === userId || directConnections.has(neighborId)) {
          return;
        }
        
        // Count mutual connections for this candidate
        let mutualCount = 0;
        const mutualIds = [];
        
        directConnections.forEach(otherDirectId => {
          const otherNeighbors = neighborMap.get(otherDirectId);
          if (otherNeighbors && otherNeighbors.has(neighborId)) {
            mutualCount++;
            if (!mutualIds.includes(otherDirectId)) {
              mutualIds.push(otherDirectId);
            }
          }
        });
        
        // Only include candidates with ≥1 mutual connection
        if (mutualCount >= 1) {
          const existing = candidates.get(neighborId);
          if (!existing || mutualCount > existing.mutualCount) {
            candidates.set(neighborId, {
              id: neighborId,
              mutualCount,
              mutualIds,
              score: Math.min(1, mutualCount / 10)
            });
          }
        }
      });
    }
  });
  
  // Convert to array and sort by mutualCount DESC, then name ASC
  const candidatesArray = Array.from(candidates.values());
  candidatesArray.sort((a, b) => {
    if (a.mutualCount !== b.mutualCount) {
      return b.mutualCount - a.mutualCount;
    }
    const nameA = nameFor(a.id) || '';
    const nameB = nameFor(b.id) || '';
    return nameA.localeCompare(nameB);
  });
  
  // Return all candidates in the expected format (no limit)
  return candidatesArray.map(candidate => ({
    user_id: candidate.id,
    name: nameFor(candidate.id),
    scores: { total: candidate.score },
    mutuals: candidate.mutualIds.slice(0, 3).map(nameFor),
    explain: `Connected through ${candidate.mutualCount} mutual friends`
  }));
}


function assembleWeeklyFromExport({ userId, taps, users, nowUtc }) {
  try {
    const now = new Date(nowUtc);
    const currentWeek = getISOWeek(now);
    const currentYear = now.getFullYear();
    
    // Get current ISO week bounds (Monday to Sunday UTC)
    const weekStart = startOfIsoWeek(now);
    const weekEnd = endOfIsoWeek(now);
    
    // Filter taps for current week
    const weekTaps = taps.filter(tap => {
      const tapTime = new Date(tap.time);
      return tapTime >= weekStart && tapTime < weekEnd;
    });
    
    // Filter taps involving the user
    const userTaps = weekTaps.filter(tap => {
      const id1 = tap.user1_id || tap.id1;
      const id2 = tap.user2_id || tap.id2;
      return id1 === userId || id2 === userId;
    });
    
    // Build user index for efficient lookups
    const usersById = buildUserIndex(users || []);
    
    // Safe name lookup using shared helpers
    const nameFor = (id) => getDisplayName(usersById.get(id) || userById(users, id));
    
    // Initialize warnings array early
    const warnings = [];
  
  // Helper to get other party ID
  const getOtherPartyId = (tap) => {
    const id1 = tap.user1_id || tap.id1;
    const id2 = tap.user2_id || tap.id2;
    return id1 === userId ? id2 : id1;
  };
  
  // 1. First degree new connections (recap)
  const firstDegreeMap = new Map();
  userTaps.forEach(tap => {
    const otherId = getOtherPartyId(tap);
    if (otherId && otherId !== userId) {
      const existing = firstDegreeMap.get(otherId);
      if (!existing || new Date(tap.time) > new Date(existing.last_tap_at)) {
        firstDegreeMap.set(otherId, {
          user_id: otherId,
          name: nameFor(otherId),
          last_tap_at: tap.time
        });
      }
    }
  });
  
  const firstDegreeNew = Array.from(firstDegreeMap.values())
    .sort((a, b) => new Date(b.last_tap_at) - new Date(a.last_tap_at))
    .slice(0, 10);
  
  // 2. Second degree delta (simplified)
  const secondDegreeDelta = firstDegreeNew.length;
  
  // 3. Community activity (daily tap counts for current week)
  const dailyTaps = {};
  weekTaps.forEach(tap => {
    const day = new Date(tap.time).toISOString().split('T')[0];
    dailyTaps[day] = (dailyTaps[day] || 0) + 1;
  });
  
  // Build 7-day array for current ISO week
  const communityActivity = [];
  for (let d = new Date(weekStart); d < weekEnd; d.setDate(d.getDate() + 1)) {
    const day = d.toISOString().split('T')[0];
    communityActivity.push({
      day: day,
      taps: dailyTaps[day] || 0
    });
  }
  
  // 4. Momentum calculations
  const weeklyTaps = userTaps.length;
  const newConnections = firstDegreeNew.length;
  
  // Calculate current streak (consecutive days up to now with taps)
  const userDailyTaps = {};
  userTaps.forEach(tap => {
    const day = new Date(tap.time).toISOString().split('T')[0];
    userDailyTaps[day] = (userDailyTaps[day] || 0) + 1;
  });
  
  let currentStreakDays = 0;
  const sortedDays = Object.keys(userDailyTaps).sort().reverse();
  for (const day of sortedDays) {
    if (userDailyTaps[day] > 0) {
      currentStreakDays++;
    } else {
      break;
    }
  }
  
  // Calculate longest streak (best effort from all data)
  let longestStreakDays = 0;
  let currentStreak = 0;
  const allUserTaps = taps.filter(tap => {
    const id1 = tap.user1_id || tap.id1;
    const id2 = tap.user2_id || tap.id2;
    return id1 === userId || id2 === userId;
  });
  
  const allUserDailyTaps = {};
  allUserTaps.forEach(tap => {
    const day = new Date(tap.time).toISOString().split('T')[0];
    allUserDailyTaps[day] = (allUserDailyTaps[day] || 0) + 1;
  });
  
  const allSortedDays = Object.keys(allUserDailyTaps).sort();
  for (const day of allSortedDays) {
    if (allUserDailyTaps[day] > 0) {
      currentStreak++;
      longestStreakDays = Math.max(longestStreakDays, currentStreak);
    } else {
      currentStreak = 0;
    }
  }
  
  // 5. Leaderboards
  // New connections leaderboard (top 5 users by count as "other party" this week)
  const otherPartyCounts = {};
  weekTaps.forEach(tap => {
    const id1 = tap.user1_id || tap.id1;
    const id2 = tap.user2_id || tap.id2;
    if (id1 !== id2) {
      otherPartyCounts[id1] = (otherPartyCounts[id1] || 0) + 1;
      otherPartyCounts[id2] = (otherPartyCounts[id2] || 0) + 1;
    }
  });
  
  const newConnectionsLeaderboard = Object.entries(otherPartyCounts)
    .filter(([id, count]) => id !== userId && count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => {
      const user = usersById.get(id);
      return {
        user_id: id,
        name: nameFor(id),
        new_first_degree: count,
        last_tap_at: new Date().toISOString() // Placeholder
      };
    });
  
  // Community builders leaderboard (top 5 users by weekly tap count)
  const weeklyTapCounts = {};
  weekTaps.forEach(tap => {
    const id1 = tap.user1_id || tap.id1;
    const id2 = tap.user2_id || tap.id2;
    weeklyTapCounts[id1] = (weeklyTapCounts[id1] || 0) + 1;
    weeklyTapCounts[id2] = (weeklyTapCounts[id2] || 0) + 1;
  });
  
  const communityBuilders = Object.entries(weeklyTapCounts)
    .filter(([id, count]) => id !== userId && count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => {
      const user = usersById.get(id);
      return {
        user_id: id,
        name: nameFor(id),
        delta_second_degree: count
      };
    });
  
  // Streak masters (placeholder - can be empty)
  const streakMasters = [];
  
  // 6. Recommendations (mutual connections algorithm) - with error handling
  let recommendations = [];
  try {
    recommendations = buildRecommendations(userId, taps, usersById, nameFor);
  } catch (e) {
    warnings.push(`recs_error:${e.message}`);
    recommendations = [];
  }
  
  // 7. Check for geohash warnings
  const hasGeohash = taps.some(tap => tap.latitude && tap.longitude);
  if (!hasGeohash) {
    warnings.push('geo_expansion not computed: no geohash in taps');
  }
  
  // Assemble final payload
  const payload = {
    source: 'reader',
    generated_at: now.toISOString(),
    week: {
      year: currentYear,
      iso_week: currentWeek,
      range: [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]
    },
    recap: {
      first_degree_new: firstDegreeNew,
      second_degree_delta: secondDegreeDelta,
      community_activity: communityActivity,
      geo_expansion: [] // Placeholder
    },
    momentum: {
      current_streak_days: currentStreakDays,
      longest_streak_days: longestStreakDays,
      weekly_taps: weeklyTaps,
      new_connections: newConnections,
      weekly_goal: {
        progress: weeklyTaps,
        target_taps: 25
      }
    },
    leaderboard: {
      new_connections: newConnectionsLeaderboard,
      community_builders: communityBuilders,
      streak_masters: streakMasters
    },
    recommendations: recommendations,
    meta: {
      source: 'reader',
      duration_ms: 0, // Will be set by caller
      user_id: userId,
      watermark: now.toISOString(),
      warnings: warnings,
      debug: {
        users_mapped: usersById.size
      }
    }
  };
  
  return payload;
  
  } catch (error) {
    console.error('❌ [assembleFromExport] Error:', error);
    
    // Return error payload with complete contract structure
    const nowUtc = new Date().toISOString();
    const now = new Date(nowUtc);
    const currentWeek = getISOWeek(now);
    const currentYear = now.getFullYear();
    const weekStart = startOfIsoWeek(now);
    const weekEnd = endOfIsoWeek(now);
    
    return {
      source: 'reader',
      generated_at: nowUtc,
      week: {
        year: currentYear,
        iso_week: currentWeek,
        range: [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]
      },
      recap: {
        first_degree_new: [],
        second_degree_delta: 0,
        community_activity: [],
        geo_expansion: []
      },
      momentum: {
        current_streak_days: 0,
        longest_streak_days: 0,
        weekly_taps: 0,
        new_connections: 0,
        weekly_goal: { progress: 0, target_taps: 25 }
      },
      leaderboard: {
        new_connections: [],
        community_builders: [],
        streak_masters: []
      },
      recommendations: [],
      meta: {
        source: 'reader',
        duration_ms: 0,
        user_id: userId,
        watermark: nowUtc,
        warnings: [`Assembler error: ${error.message}`],
        debug: {
          error: error.message,
          taps_count: Array.isArray(taps) ? taps.length : 0,
          users_count: Array.isArray(users) ? users.length : 0
        }
      }
    };
  }
}

// Helper functions
function getISOWeek(date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target) / 604800000);
}

function startOfIsoWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function endOfIsoWeek(date) {
  const start = startOfIsoWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
}

module.exports = { assembleWeeklyFromExport };
