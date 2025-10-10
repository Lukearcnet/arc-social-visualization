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
  return candidatesArray.map(candidate => {
    // Get candidate's most recent tap with coordinates
    const candidateTaps = taps.filter(tap => 
      (tap.user1_id === candidate.id || tap.user2_id === candidate.id) &&
      tap.latitude && tap.longitude
    ).sort((a, b) => new Date(b.time) - new Date(a.time));
    
    const lastTap = candidateTaps[0];
    
    return {
      user_id: candidate.id,
      name: nameFor(candidate.id),
      scores: { total: candidate.score },
      mutuals: candidate.mutualIds.slice(0, 6).map(nameFor),
      explain: `Connected through ${candidate.mutualCount} mutual friends`,
      // Add location data for city filtering
      last_tap_location: lastTap?.formatted_location || 'Unknown',
      last_tap_coordinates: lastTap ? {
        lat: lastTap.latitude,
        lng: lastTap.longitude
      } : null
    };
  });
}

// Helper function to calculate time window bounds
function getTimeWindowBounds(now, timeWindow) {
  const endTime = new Date(now);
  let startTime;
  
  // Normalize time window to rolling day windows
  const normalizedWindow = (() => {
    const aliases = {
      '1day': '1d',
      '1week': '7d', 
      '1month': '30d',
      '6months': '180d',
      '1year': '365d'
    };
    return aliases[timeWindow] || timeWindow;
  })();
  
  // Extract number of days
  const days = parseInt(normalizedWindow.replace('d', ''));
  startTime = new Date(now);
  startTime.setDate(startTime.getDate() - days);
  
  return { startTime, endTime };
}

// Calculate 1st, 2nd, and 3rd degree connections (reverted to previous logic)
function calculateDegreeConnections(userId, windowTaps, allTaps, nameFor) {
  // Build adjacency map from windowTaps only (undirected)
  const adjacencyMap = new Map();
  
  windowTaps.forEach(tap => {
    const id1 = tap.user1_id || tap.id1;
    const id2 = tap.user2_id || tap.id2;
    
    if (id1 && id2 && id1 !== id2) {
      // Add undirected edge
      if (!adjacencyMap.has(id1)) adjacencyMap.set(id1, new Set());
      if (!adjacencyMap.has(id2)) adjacencyMap.set(id2, new Set());
      
      adjacencyMap.get(id1).add(id2);
      adjacencyMap.get(id2).add(id1);
    }
  });
  
  // 1st Degree: All distinct others directly tapped with userId in windowTaps
  const firstDegreeSet = new Set();
  windowTaps.forEach(tap => {
    const id1 = tap.user1_id || tap.id1;
    const id2 = tap.user2_id || tap.id2;
    if (id1 === userId || id2 === userId) {
      const otherId = id1 === userId ? id2 : id1;
      if (otherId && otherId !== userId) {
        firstDegreeSet.add(otherId);
      }
    }
  });
  
  const firstDegreeNew = Array.from(firstDegreeSet).map(userId => ({
    user_id: userId,
    name: nameFor(userId),
    connected_via: 'direct'
  }));
  
  // 2nd Degree: Neighbors of first-degree via adjacency map, excluding userId and first-degree
  const secondDegreeMap = new Map();
  firstDegreeSet.forEach(firstDegreeId => {
    const neighbors = adjacencyMap.get(firstDegreeId);
    if (neighbors) {
      neighbors.forEach(neighborId => {
        if (neighborId !== userId && !firstDegreeSet.has(neighborId)) {
          // Store the mutual connection (first degree person who connects them)
          if (!secondDegreeMap.has(neighborId)) {
            secondDegreeMap.set(neighborId, {
              user_id: neighborId,
              name: nameFor(neighborId),
              connected_via: nameFor(firstDegreeId)
            });
          }
        }
      });
    }
  });
  
  const secondDegreeNew = Array.from(secondDegreeMap.values());
  
  // 3rd Degree: Neighbors of second-degree, excluding userId, first-degree, and second-degree
  const thirdDegreeMap = new Map();
  secondDegreeMap.forEach((secondDegreeConn, secondDegreeId) => {
    const neighbors = adjacencyMap.get(secondDegreeId);
    if (neighbors) {
      neighbors.forEach(neighborId => {
        if (neighborId !== userId && 
            !firstDegreeSet.has(neighborId) && 
            !secondDegreeMap.has(neighborId)) {
          // Store the mutual connection (second degree person who connects them)
          if (!thirdDegreeMap.has(neighborId)) {
            thirdDegreeMap.set(neighborId, {
              user_id: neighborId,
              name: nameFor(neighborId),
              connected_via: nameFor(secondDegreeId)
            });
          }
        }
      });
    }
  });
  
  const thirdDegreeNew = Array.from(thirdDegreeMap.values());
  
  return {
    firstDegreeNew,
    secondDegreeNew,
    thirdDegreeNew
  };
}

// Calculate "Expanded Reach" - net new connectors (O(E))
function calculateExpandedReach(userId, windowPairs, firstSeenAt, startTime, endTime, nameFor) {
  const netNewCount = new Map(); // user_id -> count
  
  // For every pair key with firstSeenAt[key] in window
  // This represents a "new" connection that was first seen in this time window
  windowPairs.forEach(key => {
    const firstSeen = firstSeenAt.get(key);
    // Only count connections that were FIRST SEEN in this time window (truly new)
    if (firstSeen >= startTime && firstSeen < endTime) {
      const [a, b] = key.split('|');
      // Count this as a new connection for both users
      // This is correct - each new connection benefits both parties
      netNewCount.set(a, (netNewCount.get(a) || 0) + 1);
      netNewCount.set(b, (netNewCount.get(b) || 0) + 1);
    }
  });
  
  // Debug: Log some examples to understand the counting
  console.log('🔍 [Expanded Reach] Sample pairs and counts:', {
    samplePairs: Array.from(windowPairs).slice(0, 5),
    sampleCounts: Array.from(netNewCount.entries()).slice(0, 5).map(([id, count]) => ({
      id,
      name: nameFor(id),
      count
    }))
  });
  
  // Convert to sorted array - this shows who made the most NEW connections
  const expandedReachTop = Array.from(netNewCount.entries())
    .filter(([id, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10) // Top 10
    .map(([id, count]) => ({
      user_id: id,
      name: nameFor(id),
      new_connections: count
    }));
  
  // Debug logging
  console.log('🔍 [Expanded Reach] Debug info:', {
    totalPairsInWindow: windowPairs.size,
    newConnectionsCounted: netNewCount.size,
    topResults: expandedReachTop.slice(0, 3).map(x => ({ name: x.name, connections: x.new_connections }))
  });
  
  return expandedReachTop;
}

function assembleWeeklyFromExport({ userId, taps, users, nowUtc, timeWindow = '1week', isDebug = false }) {
  try {
    // Input guards
    taps = Array.isArray(taps) ? taps : [];
    users = Array.isArray(users) ? users : [];
    
    const now = new Date(nowUtc);
    const currentWeek = getISOWeek(now);
    const currentYear = now.getFullYear();
    
    // Calculate time window bounds
    const { startTime, endTime } = getTimeWindowBounds(now, timeWindow);
    
    // Build user index for efficient lookups
    const usersById = buildUserIndex(users);
    
    // Safe name lookup using shared helpers
    const nameFor = (id) => getDisplayName(usersById.get(id) || userById(users, id));
    
    // Initialize warnings array early
    const warnings = [];
  
  // Filter taps for the selected time window (for degree calculations)
  const windowTaps = taps.filter(tap => {
    const tapTime = new Date(tap.time);
    return tapTime >= startTime && tapTime < endTime;
  });
  
  // Calculate degree connections using reverted logic
  let firstDegreeNew = [];
  let secondDegreeNew = [];
  let thirdDegreeNew = [];
  let expandedReachTop = [];
  
  console.log('🔍 [assembleFromExport] Starting degree calculation with timeWindow:', timeWindow);
  
  try {
    const degreeResults = calculateDegreeConnections(
      userId, 
      windowTaps, 
      taps, // All taps for historical context
      nameFor
    );
    
    firstDegreeNew = degreeResults.firstDegreeNew;
    secondDegreeNew = degreeResults.secondDegreeNew;
    thirdDegreeNew = degreeResults.thirdDegreeNew;
    
    // Calculate Expanded Reach using the new logic
    const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    const firstSeenAt = new Map();
    const windowPairs = new Set();
    
    // Build indexes for Expanded Reach
    taps.forEach(tap => {
      const id1 = tap.user1_id || tap.id1;
      const id2 = tap.user2_id || tap.id2;
      const time = new Date(tap.time);
      
      if (!id1 || !id2 || id1 === id2) return;
      
      const key = pairKey(id1, id2);
      
      // Update earliest time for this pair
      if (!firstSeenAt.has(key) || time < firstSeenAt.get(key)) {
        firstSeenAt.set(key, time);
      }
      
      // If tap is in window, add to window structures
      if (time >= startTime && time < endTime) {
        windowPairs.add(key);
      }
    });
    
    expandedReachTop = calculateExpandedReach(
      userId,
      windowPairs,
      firstSeenAt,
      startTime,
      endTime,
      nameFor
    );
    
    console.log('✅ [assembleFromExport] Degree calculation successful:', {
      first: firstDegreeNew.length,
      second: secondDegreeNew.length,
      third: thirdDegreeNew.length,
      expandedReach: expandedReachTop.length
    });
    
  } catch (degreeError) {
    console.error('❌ [assembleFromExport] Degree calculation error:', degreeError);
    warnings.push(`degree_calculation_error:${degreeError.message}`);
    
    // Fallback to empty arrays on error
    firstDegreeNew = [];
    secondDegreeNew = [];
    thirdDegreeNew = [];
    expandedReachTop = [];
  }
  
  // 3. Community activity (daily tap counts for time window)
  const dailyTaps = {};
  taps.forEach(tap => {
    const tapTime = new Date(tap.time);
    if (tapTime >= startTime && tapTime < endTime) {
      const day = tapTime.toISOString().split('T')[0];
      dailyTaps[day] = (dailyTaps[day] || 0) + 1;
    }
  });
  
  // Build activity array for time window
  const communityActivity = [];
  for (let d = new Date(startTime); d < endTime; d.setDate(d.getDate() + 1)) {
    const day = d.toISOString().split('T')[0];
    communityActivity.push({
      day: day,
      taps: dailyTaps[day] || 0
    });
  }
  
  // 4. Momentum calculations
  // Count user taps in window
  const userTapsInWindow = taps.filter(tap => {
    const tapTime = new Date(tap.time);
    const id1 = tap.user1_id || tap.id1;
    const id2 = tap.user2_id || tap.id2;
    return (id1 === userId || id2 === userId) && tapTime >= startTime && tapTime < endTime;
  });
  
  const weeklyTaps = userTapsInWindow.length;
  const newConnections = firstDegreeNew.length;
  
  // Calculate current streak (consecutive days up to now with taps)
  const userDailyTaps = {};
  userTapsInWindow.forEach(tap => {
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
  // New connections leaderboard (top 5 users by tap count with the main user in time window)
  const userTapCounts = {};
  taps.forEach(tap => {
    const tapTime = new Date(tap.time);
    if (tapTime >= startTime && tapTime < endTime) {
      const id1 = tap.user1_id || tap.id1;
      const id2 = tap.user2_id || tap.id2;
      // Only count taps involving the main user
      if ((id1 === userId || id2 === userId) && id1 !== id2) {
        const otherId = id1 === userId ? id2 : id1;
        userTapCounts[otherId] = (userTapCounts[otherId] || 0) + 1;
      }
    }
  });
  
  const newConnectionsLeaderboard = Object.entries(userTapCounts)
    .filter(([id, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => {
      return {
        user_id: id,
        name: nameFor(id),
        tap_count: count,
        last_tap_at: new Date().toISOString() // Placeholder
      };
    });
  
  // Community builders leaderboard (top 5 users by tap count in time window)
  const windowTapCounts = {};
  taps.forEach(tap => {
    const tapTime = new Date(tap.time);
    if (tapTime >= startTime && tapTime < endTime) {
      const id1 = tap.user1_id || tap.id1;
      const id2 = tap.user2_id || tap.id2;
      windowTapCounts[id1] = (windowTapCounts[id1] || 0) + 1;
      windowTapCounts[id2] = (windowTapCounts[id2] || 0) + 1;
    }
  });
  
  const communityBuilders = Object.entries(windowTapCounts)
    .filter(([id, count]) => count > 0)
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
      range: [startTime.toISOString().split('T')[0], endTime.toISOString().split('T')[0]],
      time_window: timeWindow
    },
    recap: {
      first_degree_new: firstDegreeNew,
      second_degree_new: secondDegreeNew,
      third_degree_new: thirdDegreeNew,
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
      streak_masters: streakMasters,
      connectors: expandedReachTop
    },
    recommendations: recommendations,
    meta: {
      source: 'reader',
      duration_ms: 0, // Will be set by caller
      user_id: userId,
      watermark: now.toISOString(),
      time_window: (() => {
        const aliases = {
          '1day': '1d',
          '1week': '7d', 
          '1month': '30d',
          '6months': '180d',
          '1year': '365d'
        };
        return aliases[timeWindow] || timeWindow;
      })(),
      warnings: warnings,
      debug: {
        users_mapped: usersById.size,
        tw_raw: timeWindow,
        window_start: startTime.toISOString(),
        window_end: endTime.toISOString(),
        taps_in_window: (() => {
          let count = 0;
          taps.forEach(tap => {
            const tapTime = new Date(tap.time);
            if (tapTime >= startTime && tapTime < endTime) count++;
          });
          return count;
        })(),
        unique_pairs_in_window: (() => {
          const pairs = new Set();
          taps.forEach(tap => {
            const tapTime = new Date(tap.time);
            if (tapTime >= startTime && tapTime < endTime) {
              const id1 = tap.user1_id || tap.id1;
              const id2 = tap.user2_id || tap.id2;
              if (id1 && id2) {
                const pair = [id1, id2].sort().join('|');
                pairs.add(pair);
              }
            }
          });
          return pairs.size;
        })(),
        degree_counts: {
          first: firstDegreeNew.length,
          second: secondDegreeNew.length,
          third: thirdDegreeNew.length
        },
        expanded_reach_sample: expandedReachTop.slice(0, 5),
        new_connections_sample: newConnectionsLeaderboard.slice(0, 3),
        leaderboard_comparison: {
          new_connections_count: newConnectionsLeaderboard.length,
          expanded_reach_count: expandedReachTop.length,
          new_connections_top3: newConnectionsLeaderboard.slice(0, 3).map(x => ({ name: x.name, count: x.tap_count })),
          expanded_reach_top3: expandedReachTop.slice(0, 3).map(x => ({ name: x.name, count: x.new_connections }))
        }
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
        second_degree_new: [],
        third_degree_new: [],
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
