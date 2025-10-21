// lib/weekly/assembleFromExport.js
// Weekly payload assembler from Data Reader export
// Date: 2025-01-15

const { getDisplayName, userById, buildUserIndex } = require('../community/names');

// Helper function to build recommendations using enhanced multi-factor algorithm
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
  
  // Get user's profile data for similarity calculations
  const userProfile = usersById.get(userId);
  const userHome = userProfile?.home_location?.home_location || userProfile?.home || '';
  const userAge = userProfile?.basic_info?.age || '';
  const userBio = userProfile?.bio_analysis?.bio_text || '';
  
  // Get user's recent tap locations for location affinity
  const userRecentTaps = taps
    .filter(tap => (tap.user1_id === userId || tap.user2_id === userId) && 
                   new Date(tap.time) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // Last 7 days
    .filter(tap => tap.latitude && tap.longitude)
    .slice(0, 5); // Last 5 recent taps
  
  // Find candidates: neighbors-of-neighbors that are not userId and not in direct
  const candidates = new Map(); // candidateId -> { mutualCount, mutualNames, scores }
  
  directConnections.forEach(directId => {
    const neighbors = neighborMap.get(directId);
    if (neighbors) {
      neighbors.forEach(neighborId => {
        // Skip if neighbor is userId or already a direct connection
        if (neighborId === userId || directConnections.has(neighborId)) {
          return;
        }
        
        // Count mutual connections and calculate mutual taps for this candidate
        let mutualCount = 0;
        const mutualIds = [];
        const mutualDetails = [];
        let mutualTaps = 0;
        let mutualStrengthScore = 0;
        
        directConnections.forEach(otherDirectId => {
          const otherNeighbors = neighborMap.get(otherDirectId);
          if (otherNeighbors && otherNeighbors.has(neighborId)) {
            mutualCount++;
            if (!mutualIds.includes(otherDirectId)) {
              mutualIds.push(otherDirectId);
            }
            
            // Calculate mutual taps: (my taps with friend) + (candidate taps with friend)
            const myTapsWithFriend = normalizedTaps.filter(tap => 
              (tap.a === userId && tap.b === otherDirectId) || 
              (tap.b === userId && tap.a === otherDirectId)
            ).length;
            
            const candidateTapsWithFriend = normalizedTaps.filter(tap => 
              (tap.a === neighborId && tap.b === otherDirectId) || 
              (tap.b === neighborId && tap.a === otherDirectId)
            ).length;
            
            const mutualTapCount = myTapsWithFriend + candidateTapsWithFriend;
            mutualTaps += mutualTapCount;
            
            // Store mutual details with tap count
            mutualDetails.push({
              id: otherDirectId,
              name: nameFor(otherDirectId),
              tapCount: mutualTapCount
            });
            
            // Calculate mutual strength based on the mutual friend's activity
            const mutualFriend = usersById.get(otherDirectId);
            if (mutualFriend) {
              const tapCount = mutualFriend.profile_stats?.tap_count || 0;
              const connectionsCount = mutualFriend.profile_stats?.connections_count || 0;
              const activityScore = Math.min(1, (tapCount + connectionsCount) / 100);
              mutualStrengthScore += activityScore;
            }
          }
        });
        
        // Only include candidates with ≥1 mutual connection
        if (mutualCount >= 1) {
          const candidateProfile = usersById.get(neighborId);
          
          // Calculate location affinity score
          const candidateTaps = taps.filter(tap => 
            (tap.user1_id === neighborId || tap.user2_id === neighborId) &&
            tap.latitude && tap.longitude
          ).sort((a, b) => new Date(b.time) - new Date(a.time));
          
          const lastTap = candidateTaps[0];
          let locationScore = 0;
          
          if (lastTap) {
            // Check proximity to user's home location
            if (userHome && candidateProfile?.home_location?.home_location) {
              const homeMatch = userHome.toLowerCase().includes(candidateProfile.home_location.home_location.toLowerCase()) ||
                               candidateProfile.home_location.home_location.toLowerCase().includes(userHome.toLowerCase());
              if (homeMatch) locationScore += 0.5;
            }
            
            // Check proximity to user's recent tap locations
            if (userRecentTaps.length > 0) {
              const candidateLat = parseFloat(lastTap.latitude);
              const candidateLng = parseFloat(lastTap.longitude);
              
              let minDistance = Infinity;
              userRecentTaps.forEach(userTap => {
                const distance = getDistanceFromLatLonInMiles(
                  parseFloat(userTap.latitude), parseFloat(userTap.longitude),
                  candidateLat, candidateLng
                );
                minDistance = Math.min(minDistance, distance);
              });
              
              // Exponential decay: closer = higher score
              if (minDistance < Infinity) {
                locationScore += Math.exp(-minDistance / 50); // 50 mile decay constant
              }
            }
          }
          
          // Calculate profile similarity score
          let profileScore = 0;
          
          // Age bucket similarity
          if (userAge && candidateProfile?.basic_info?.age) {
            const userAgeNum = parseInt(userAge) || 0;
            const candidateAgeNum = parseInt(candidateProfile.basic_info.age) || 0;
            if (userAgeNum > 0 && candidateAgeNum > 0) {
              const ageDiff = Math.abs(userAgeNum - candidateAgeNum);
              if (ageDiff <= 2) profileScore += 0.4; // Same bucket
              else if (ageDiff <= 5) profileScore += 0.2; // Adjacent bucket
            }
          }
          
          // Bio similarity (simple keyword overlap)
          if (userBio && candidateProfile?.bio_analysis?.bio_text) {
            const userWords = userBio.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const candidateWords = candidateProfile.bio_analysis.bio_text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const commonWords = userWords.filter(word => candidateWords.includes(word));
            if (userWords.length > 0) {
              profileScore += (commonWords.length / userWords.length) * 0.3;
            }
          }
          
          // Home location similarity
          if (userHome && candidateProfile?.home_location?.home_location) {
            const userCity = userHome.split(',')[0].trim().toLowerCase();
            const candidateCity = candidateProfile.home_location.home_location.split(',')[0].trim().toLowerCase();
            if (userCity === candidateCity) {
              profileScore += 0.3;
            }
          }
          
          // Calculate composite score
          const mutualStrengthScoreNormalized = Math.min(1, mutualStrengthScore / mutualCount);
          const locationScoreNormalized = Math.min(1, locationScore);
          const profileScoreNormalized = Math.min(1, profileScore);
          
          const compositeScore = (
            mutualStrengthScoreNormalized * 0.40 +  // 40% mutual strength
            locationScoreNormalized * 0.30 +        // 30% location affinity  
            profileScoreNormalized * 0.30           // 30% profile similarity
          );
          
          const existing = candidates.get(neighborId);
          if (!existing || compositeScore > existing.compositeScore) {
            candidates.set(neighborId, {
              id: neighborId,
              mutualCount,
              mutualIds,
              mutualDetails,
              mutualTaps,
              compositeScore,
              mutualStrengthScore: mutualStrengthScoreNormalized,
              locationScore: locationScoreNormalized,
              profileScore: profileScoreNormalized
            });
          }
        }
      });
    }
  });
  
  // Convert to array and sort by composite score DESC, then name ASC
  const candidatesArray = Array.from(candidates.values());
  candidatesArray.sort((a, b) => {
    if (Math.abs(a.compositeScore - b.compositeScore) > 0.01) {
      return b.compositeScore - a.compositeScore;
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
      scores: { 
        total: candidate.compositeScore,
        mutual_strength: candidate.mutualStrengthScore,
        location_affinity: candidate.locationScore,
        profile_similarity: candidate.profileScore,
        mutual_connections: candidate.mutualCount,
        mutual_taps: candidate.mutualTaps
      },
      mutuals: candidate.mutualIds.slice(0, 6).map(nameFor),
      mutualDetails: candidate.mutualDetails,
      explain: `Connected through ${candidate.mutualCount} mutual friends`,
      degree: 2, // Explicitly set degree for 2nd degree recommendations
      // Add location data for city filtering
      last_tap_location: lastTap?.formatted_location || 'Unknown',
      last_tap_coordinates: lastTap ? {
        lat: lastTap.latitude,
        lng: lastTap.longitude
      } : null
    };
  });
}

// Helper function to calculate distance between two coordinates
function getDistanceFromLatLonInMiles(lat1, lon1, lat2, lon2) {
  const R = 3959; // Radius of the earth in miles
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI/180);
}

// Helper function to build 3rd degree recommendations
function buildThirdDegreeRecommendations(userId, taps, usersById, nameFor) {
  // Normalize taps to { a, b, time } format
  const normalizedTaps = taps.map(tap => {
    const a = tap.user1_id || tap.id1;
    const b = tap.user2_id || tap.id2;
    return { a, b, time: tap.time };
  }).filter(tap => tap.a && tap.b && tap.a !== tap.b);
  
  // Build direct connections set for userId
  const directConnections = new Set();
  normalizedTaps.forEach(tap => {
    if (tap.a === userId) {
      directConnections.add(tap.b);
    } else if (tap.b === userId) {
      directConnections.add(tap.a);
    }
  });
  
  // Build 2nd degree connections (neighbors of direct connections)
  const secondDegreeConnections = new Set();
  const secondDegreeMap = new Map(); // 2nd degree id -> { via: direct connection id }
  
  directConnections.forEach(directId => {
    normalizedTaps.forEach(tap => {
      if (tap.a === directId && tap.b !== userId && !directConnections.has(tap.b)) {
        secondDegreeConnections.add(tap.b);
        if (!secondDegreeMap.has(tap.b)) {
          secondDegreeMap.set(tap.b, { via: directId });
        }
      } else if (tap.b === directId && tap.a !== userId && !directConnections.has(tap.a)) {
        secondDegreeConnections.add(tap.a);
        if (!secondDegreeMap.has(tap.a)) {
          secondDegreeMap.set(tap.a, { via: directId });
        }
      }
    });
  });
  
  // Build 3rd degree connections (neighbors of 2nd degree connections)
  const thirdDegreeCandidates = new Map(); // candidateId -> { bridgePaths, score }
  
  secondDegreeConnections.forEach(secondDegreeId => {
    normalizedTaps.forEach(tap => {
      let thirdDegreeId = null;
      if (tap.a === secondDegreeId && tap.b !== userId && !directConnections.has(tap.b) && !secondDegreeConnections.has(tap.b)) {
        thirdDegreeId = tap.b;
      } else if (tap.b === secondDegreeId && tap.a !== userId && !directConnections.has(tap.a) && !secondDegreeConnections.has(tap.a)) {
        thirdDegreeId = tap.a;
      }
      
      if (thirdDegreeId) {
        const bridgePath = {
          direct: secondDegreeMap.get(secondDegreeId).via,
          second: secondDegreeId,
          third: thirdDegreeId
        };
        
        if (!thirdDegreeCandidates.has(thirdDegreeId)) {
          thirdDegreeCandidates.set(thirdDegreeId, {
            id: thirdDegreeId,
            bridgePaths: [],
            score: 0
          });
        }
        
        const candidate = thirdDegreeCandidates.get(thirdDegreeId);
        
        // Check if this bridge path already exists to avoid duplicates
        const pathExists = candidate.bridgePaths.some(existingPath => 
          existingPath.direct === bridgePath.direct && 
          existingPath.second === bridgePath.second && 
          existingPath.third === bridgePath.third
        );
        
        if (!pathExists) {
          candidate.bridgePaths.push(bridgePath);
        }
      }
    });
  });
  
  // Filter for quality: require at least 2 bridge paths
  const qualityCandidates = Array.from(thirdDegreeCandidates.values())
    .filter(candidate => candidate.bridgePaths.length >= 2);
  
  // Calculate scores for 3rd degree candidates
  qualityCandidates.forEach(candidate => {
    // Base score from number of bridge paths (more paths = higher score)
    const pathScore = Math.min(1, candidate.bridgePaths.length / 5); // Normalize to 0-1
    
    // Get candidate's profile for additional scoring
    const candidateProfile = usersById.get(candidate.id);
    let activityScore = 0;
    
    if (candidateProfile) {
      const tapCount = candidateProfile.profile_stats?.tap_count || 0;
      const connectionsCount = candidateProfile.profile_stats?.connections_count || 0;
      activityScore = Math.min(1, (tapCount + connectionsCount) / 100);
    }
    
    // Calculate bridge path strength (quality of intermediate connections)
    let bridgeStrength = 0;
    candidate.bridgePaths.forEach(path => {
      const secondDegreeProfile = usersById.get(path.second);
      if (secondDegreeProfile) {
        const secondDegreeActivity = (secondDegreeProfile.profile_stats?.tap_count || 0) + 
                                   (secondDegreeProfile.profile_stats?.connections_count || 0);
        bridgeStrength += Math.min(1, secondDegreeActivity / 50);
      }
    });
    bridgeStrength = Math.min(1, bridgeStrength / candidate.bridgePaths.length);
    
    // Composite score for 3rd degree (50% weight of 2nd degree)
    candidate.score = (
      pathScore * 0.4 +           // 40% number of bridge paths
      activityScore * 0.3 +       // 30% candidate activity
      bridgeStrength * 0.3       // 30% bridge path quality
    ) * 0.5; // 50% weight vs 2nd degree
  });
  
  // Sort by score DESC, then name ASC
  qualityCandidates.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.01) {
      return b.score - a.score;
    }
    const nameA = nameFor(a.id) || '';
    const nameB = nameFor(b.id) || '';
    return nameA.localeCompare(nameB);
  });
  
  // Return 3rd degree recommendations
  return qualityCandidates.map(candidate => {
    // Get candidate's most recent tap with coordinates
    const candidateTaps = taps.filter(tap => 
      (tap.user1_id === candidate.id || tap.user2_id === candidate.id) &&
      tap.latitude && tap.longitude
    ).sort((a, b) => new Date(b.time) - new Date(a.time));
    
    const lastTap = candidateTaps[0];
    
    // Create bridge path display
    const bridgePathDisplay = candidate.bridgePaths
      .slice(0, 2) // Show up to 2 bridge paths
      .map(path => `${nameFor(path.direct)} → ${nameFor(path.second)}`)
      .join(', ');
    
    // Get candidate profile for activity level
    const candidateProfile = usersById.get(candidate.id);
    
    // Calculate mutual taps for 3rd degree (through bridge paths)
    let mutualTaps = 0;
    const bridgePathDetails = [];
    
    candidate.bridgePaths.forEach(path => {
      // Count taps between me and the direct connection
      const myTapsWithDirect = normalizedTaps.filter(tap => 
        (tap.a === userId && tap.b === path.direct) || 
        (tap.b === userId && tap.a === path.direct)
      ).length;
      
      // Count taps between candidate and the second degree connection
      const candidateTapsWithSecond = normalizedTaps.filter(tap => 
        (tap.a === candidate.id && tap.b === path.second) || 
        (tap.b === candidate.id && tap.a === path.second)
      ).length;
      
      const pathTapCount = myTapsWithDirect + candidateTapsWithSecond;
      mutualTaps += pathTapCount;
      
      // Store bridge path details with tap count
      bridgePathDetails.push({
        direct: path.direct,
        second: path.second,
        direct_name: nameFor(path.direct),
        second_name: nameFor(path.second),
        tapCount: pathTapCount
      });
    });
    
    return {
      user_id: candidate.id,
      name: nameFor(candidate.id),
      scores: { 
        total: candidate.score,
        bridge_paths: candidate.bridgePaths.length,
        activity_level: candidateProfile?.profile_stats?.tap_count || 0,
        mutual_connections: candidate.bridgePaths.length, // Bridge paths count as connections
        mutual_taps: mutualTaps
      },
      mutuals: [], // No direct mutuals for 3rd degree
      bridgePathDetails: bridgePathDetails,
      explain: `Connected through ${candidate.bridgePaths.length} bridge paths: ${bridgePathDisplay}`,
      bridge_paths: candidate.bridgePaths.map(path => ({
        direct: path.direct,
        second: path.second,
        direct_name: nameFor(path.direct),
        second_name: nameFor(path.second)
      })),
      degree: 3,
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

// Calculate 1st, 2nd, and 3rd degree connections (fixed logic for 2nd/3rd degree)
function calculateDegreeConnections(userId, windowTaps, allTaps, nameFor) {
  const toStr = (x) => (x == null ? null : String(x));
  const norm = (t) => {
    const a = toStr(t?.user1_id ?? t?.id1);
    const b = toStr(t?.user2_id ?? t?.id2);
    return (a && b && a !== b) ? [a, b] : null;
  };

  // 1️⃣ 1st-degree (display only) — still limited to the window
  const firstDegreeWindow = new Set();
  for (const t of windowTaps || []) {
    const p = norm(t); if (!p) continue;
    const [id1, id2] = p;
    if (id1 === userId) firstDegreeWindow.add(id2);
    if (id2 === userId) firstDegreeWindow.add(id1);
  }

  // 2️⃣ Historical adjacency from all taps
  const adj = new Map();
  const ensure = (k) => (adj.has(k) ? adj.get(k) : (adj.set(k, new Set()), adj.get(k)));
  for (const t of allTaps || []) {
    const p = norm(t); if (!p) continue;
    const [a, b] = p; ensure(a).add(b); ensure(b).add(a);
  }

  // 3️⃣ Historical 1st-degree SEEDS (key fix)
  const firstHist = new Set();
  for (const t of allTaps || []) {
    const p = norm(t); if (!p) continue;
    const [id1, id2] = p;
    if (id1 === userId) firstHist.add(id2);
    if (id2 === userId) firstHist.add(id1);
  }

  // 4️⃣ Precompute window edge set (for fast lookups)
  const edgeKey = (x, y) => (x < y ? `${x}-${y}` : `${y}-${x}`);
  const winEdges = new Set();
  for (const t of windowTaps || []) {
    const p = norm(t); if (!p) continue;
    const [a, b] = p; winEdges.add(edgeKey(a, b));
  }
  const inWindow = (a, b) => winEdges.has(edgeKey(a, b));

  // 5️⃣ Second-degree (neighbors of historical 1st-degree where last hop is in window)
  const secondMap = new Map();
  for (const fd of firstHist) {
    const nbrs = adj.get(fd); if (!nbrs) continue;
    for (const nb of nbrs) {
      if (nb === userId) continue;
      if (firstHist.has(nb)) continue;
      if (!inWindow(fd, nb)) continue;
      if (!secondMap.has(nb)) {
        secondMap.set(nb, {
          user_id: nb,
          name: typeof nameFor === 'function' ? (nameFor(nb) || nb) : nb,
          connected_via: typeof nameFor === 'function' ? (nameFor(fd) || fd) : fd
        });
      }
    }
  }

  // 6️⃣ Third-degree (neighbors of historical 2nd-degree, last hop in window)
  const secondHist = new Set(secondMap.keys());
  for (const fd of firstHist) {
    const nbrs = adj.get(fd); if (!nbrs) continue;
    for (const nb of nbrs) {
      if (nb !== userId && !firstHist.has(nb)) secondHist.add(nb);
    }
  }

  const thirdMap = new Map();
  for (const sd of secondHist) {
    const nbrs = adj.get(sd); if (!nbrs) continue;
    for (const nb of nbrs) {
      if (nb === userId) continue;
      if (firstHist.has(nb)) continue;
      if (secondHist.has(nb)) continue;
      if (!inWindow(sd, nb)) continue;
      if (!thirdMap.has(nb)) {
        thirdMap.set(nb, {
          user_id: nb,
          name: typeof nameFor === 'function' ? (nameFor(nb) || nb) : nb,
          connected_via: typeof nameFor === 'function' ? (nameFor(sd) || sd) : sd
        });
      }
    }
  }

  const firstDegreeNew = Array.from(firstDegreeWindow).map(id => ({
    user_id: id,
    name: typeof nameFor === 'function' ? (nameFor(id) || id) : id,
    connected_via: 'direct'
  }));

  return {
    firstDegreeNew,
    secondDegreeNew: Array.from(secondMap.values()),
    thirdDegreeNew: Array.from(thirdMap.values())
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
  
  // 6. Recommendations (enhanced 2nd and 3rd degree algorithm) - with error handling
  let secondDegreeRecommendations = [];
  let thirdDegreeRecommendations = [];
  
  try {
    secondDegreeRecommendations = buildRecommendations(userId, taps, usersById, nameFor);
  } catch (e) {
    warnings.push(`recs_2nd_error:${e.message}`);
    secondDegreeRecommendations = [];
  }
  
  try {
    thirdDegreeRecommendations = buildThirdDegreeRecommendations(userId, taps, usersById, nameFor);
  } catch (e) {
    warnings.push(`recs_3rd_error:${e.message}`);
    thirdDegreeRecommendations = [];
  }
  
  // Combine recommendations with proper weighting
  const allRecommendations = [
    ...secondDegreeRecommendations,
    ...thirdDegreeRecommendations
  ];
  
  // Sort combined recommendations by score
  allRecommendations.sort((a, b) => {
    if (Math.abs(a.scores.total - b.scores.total) > 0.01) {
      return b.scores.total - a.scores.total;
    }
    const nameA = a.name || '';
    const nameB = b.name || '';
    return nameA.localeCompare(nameB);
  });
  
  const recommendations = allRecommendations;
  
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
