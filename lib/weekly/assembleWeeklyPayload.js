// lib/weekly/assembleWeeklyPayload.js
// Weekly payload assembler for Community API
// Date: 2025-01-15

async function assembleWeeklyPayload(db, options = {}) {
  const { userId, debug = false, tz = process.env.WEEK_TZ || 'America/Chicago' } = options;
  
  const now = new Date();
  const currentWeek = getISOWeek(now);
  const currentYear = now.getFullYear();
  
  // Timezone-aware ISO week calculations
  const weekStart = startOfIsoWeek(now, tz);
  const weekEnd = endOfIsoWeek(now, tz);
  
  const warnings = [];
  
  // Initialize trace object if debug mode
  const trace = debug ? {
    tz,
    now_utc: now.toISOString(),
    week: {
      start_utc: weekStart.toISOString(),
      end_utc: weekEnd.toISOString(),
      start_tz: weekStart.toLocaleString('en-US', { timeZone: tz }),
      end_tz: weekEnd.toLocaleString('en-US', { timeZone: tz })
    },
    queries: {}
  } : null;
  
  // Get current week range (UTC timestamps for SQL)
  const weekStartStr = weekStart.toISOString();
  const weekEndStr = weekEnd.toISOString();
  
  // 1. First degree new connections (recap)
  const firstDegreeNewQuery = `
    WITH wk AS (
      SELECT *
      FROM public.taps
      WHERE "time" >= $1::timestamptz AND "time" < $2::timestamptz
        AND (id1 = $3 OR id2 = $3)
    ), parties AS (
      SELECT CASE WHEN id1 = $3 THEN id2 ELSE id1 END AS other_id,
             MAX("time") AS last_tap_at
      FROM wk
      GROUP BY 1
    )
    SELECT u.id as user_id, 
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username, 'Unknown') AS name, 
           p.last_tap_at
    FROM parties p
    JOIN public.users u ON u.id = p.other_id
    ORDER BY p.last_tap_at DESC
    LIMIT 10
  `;
  
  const firstDegreeResult = await db.query(firstDegreeNewQuery, [weekStartStr, weekEndStr, userId]);
  const firstDegreeNew = firstDegreeResult.rows.map(row => ({
    user_id: row.user_id,
    name: row.name,
    last_tap_at: row.last_tap_at
  }));
  
  // Trace logging for first degree connections
  if (trace) {
    trace.queries.first_degree_new = {
      text: firstDegreeNewQuery,
      params: [weekStartStr, weekEndStr, userId],
      row_count: firstDegreeResult.rows.length,
      sample: firstDegreeResult.rows.slice(0, 3).map(row => ({
        user_id: row.user_id,
        name: row.name,
        last_tap_at: row.last_tap_at
      }))
    };
  }
  
  // 2. Second degree delta (simplified - count of new connections this week)
  const secondDegreeDelta = firstDegreeNew.length;
  
  // 3. Community activity (daily tap counts for current week)
  // First get raw taps for trace
  const communityActivityRawQuery = `
    SELECT "time", id1, id2
    FROM public.taps
    WHERE "time" >= $1::timestamptz AND "time" < $2::timestamptz
    ORDER BY "time" DESC
    LIMIT 100
  `;
  
  const communityActivityRawResult = await db.query(communityActivityRawQuery, [weekStartStr, weekEndStr]);
  
  // Then get aggregated daily counts
  const communityActivityQuery = `
    SELECT 
      DATE("time") as day,
      COUNT(*) as taps
    FROM public.taps
    WHERE "time" >= $1::timestamptz AND "time" < $2::timestamptz
    GROUP BY DATE("time")
    ORDER BY day DESC
  `;
  
  const communityActivityResult = await db.query(communityActivityQuery, [weekStartStr, weekEndStr]);
  const communityActivity = communityActivityResult.rows.map(row => ({
    day: row.day,
    taps: parseInt(row.taps)
  }));
  
  // Trace logging for community activity
  if (trace) {
    trace.queries.community_activity_raw = {
      text: communityActivityRawQuery,
      params: [weekStartStr, weekEndStr],
      row_count: communityActivityRawResult.rows.length,
      sample: communityActivityRawResult.rows.slice(0, 3).map(row => ({
        time: row.time,
        id1: row.id1,
        id2: row.id2
      }))
    };
    
    trace.queries.community_activity_daily = {
      text: communityActivityQuery,
      params: [weekStartStr, weekEndStr],
      row_count: communityActivityResult.rows.length,
      sample: communityActivityResult.rows.slice(0, 3).map(row => ({
        day: row.day,
        taps: parseInt(row.taps)
      }))
    };
  }
  
  // 4. Momentum calculations
  // First get streak source data (last 60 days)
  const streakSourceQuery = `
    SELECT "time"
    FROM public.taps
    WHERE (id1 = $1 OR id2 = $1)
      AND "time" >= $2::timestamptz AND "time" < $3::timestamptz
    ORDER BY "time" DESC
    LIMIT 1000
  `;
  
  const streakSourceResult = await db.query(streakSourceQuery, [userId, weekStartStr, weekEndStr]);
  
  const momentumQuery = `
    WITH user_taps AS (
      SELECT "time"
      FROM public.taps
      WHERE (id1 = $1 OR id2 = $1)
        AND "time" >= $2::timestamptz AND "time" < $3::timestamptz
    ),
    daily_activity AS (
      SELECT DATE("time") as day, COUNT(*) as daily_taps
      FROM user_taps
      GROUP BY DATE("time")
    ),
    streaks AS (
      SELECT 
        day,
        daily_taps,
        ROW_NUMBER() OVER (ORDER BY day DESC) as rn,
        ROW_NUMBER() OVER (ORDER BY day DESC) - ROW_NUMBER() OVER (PARTITION BY CASE WHEN daily_taps > 0 THEN 1 ELSE 0 END ORDER BY day DESC) as streak_group
      FROM daily_activity
    ),
    streak_lengths AS (
      SELECT 
        streak_group,
        COUNT(*) as streak_length
      FROM streaks
      WHERE daily_taps > 0
      GROUP BY streak_group
    )
    SELECT 
      (SELECT COUNT(*) FROM user_taps) as weekly_taps,
      COALESCE((SELECT MAX(streak_length) FROM streak_lengths), 0) as current_streak_days,
      COALESCE((SELECT MAX(streak_length) FROM streak_lengths), 0) as longest_streak_days
  `;
  
  const momentumResult = await db.query(momentumQuery, [userId, weekStartStr, weekEndStr]);
  const momentum = momentumResult.rows[0];
  
  // Trace logging for momentum
  if (trace) {
    trace.queries.streak_source = {
      text: streakSourceQuery,
      params: [userId, weekStartStr, weekEndStr],
      row_count: streakSourceResult.rows.length,
      sample: streakSourceResult.rows.slice(0, 3).map(row => ({
        time: row.time
      }))
    };
  }
  
  // 5. Leaderboards
  // New connections leaderboard
  const newConnectionsQuery = `
    WITH wk AS (
      SELECT *
      FROM public.taps
      WHERE "time" >= $1::timestamptz AND "time" < $2::timestamptz
    ), user_connections AS (
      SELECT 
        CASE WHEN id1 = $3 THEN id2 ELSE id1 END AS other_id,
        COUNT(*) as new_first_degree,
        MAX("time") as last_tap_at
      FROM wk
      WHERE (id1 = $3 OR id2 = $3)
      GROUP BY other_id
    )
    SELECT 
      uc.other_id as user_id,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username, 'Unknown') AS name,
      uc.new_first_degree,
      uc.last_tap_at
    FROM user_connections uc
    JOIN public.users u ON u.id = uc.other_id
    WHERE uc.other_id != $3
    ORDER BY uc.new_first_degree DESC, uc.last_tap_at DESC
    LIMIT 5
  `;
  
  const newConnectionsResult = await db.query(newConnectionsQuery, [weekStartStr, weekEndStr, userId]);
  const newConnections = newConnectionsResult.rows.map(row => ({
    user_id: row.user_id,
    name: row.name,
    new_first_degree: parseInt(row.new_first_degree),
    last_tap_at: row.last_tap_at
  }));
  
  // Trace logging for new connections leaderboard
  if (trace) {
    trace.queries.leaderboard_new_connections = {
      text: newConnectionsQuery,
      params: [weekStartStr, weekEndStr, userId],
      row_count: newConnectionsResult.rows.length,
      sample: newConnectionsResult.rows.slice(0, 3).map(row => ({
        user_id: row.user_id,
        name: row.name,
        new_first_degree: parseInt(row.new_first_degree),
        last_tap_at: row.last_tap_at
      }))
    };
  }
  
  // Community builders leaderboard
  const communityBuildersQuery = `
    WITH weekly_taps AS (
      SELECT 
        CASE WHEN id1 = $1 THEN id2 ELSE id1 END AS user_id,
        COUNT(*) as tap_count
      FROM public.taps
      WHERE "time" >= $2::timestamptz AND "time" < $3::timestamptz
        AND (id1 = $1 OR id2 = $1)
      GROUP BY user_id
    )
    SELECT 
      wt.user_id,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username, 'Unknown') AS name,
      wt.tap_count as delta_second_degree
    FROM weekly_taps wt
    JOIN public.users u ON u.id = wt.user_id
    WHERE wt.user_id != $1
    ORDER BY wt.tap_count DESC
    LIMIT 5
  `;
  
  const communityBuildersResult = await db.query(communityBuildersQuery, [userId, weekStartStr, weekEndStr]);
  const communityBuilders = communityBuildersResult.rows.map(row => ({
    user_id: row.user_id,
    name: row.name,
    delta_second_degree: parseInt(row.delta_second_degree)
  }));
  
  // Trace logging for community builders leaderboard
  if (trace) {
    trace.queries.leaderboard_community_builders = {
      text: communityBuildersQuery,
      params: [userId, weekStartStr, weekEndStr],
      row_count: communityBuildersResult.rows.length,
      sample: communityBuildersResult.rows.slice(0, 3).map(row => ({
        user_id: row.user_id,
        name: row.name,
        delta_second_degree: parseInt(row.delta_second_degree)
      }))
    };
  }
  
  // Streak masters leaderboard (simplified)
  const streakMastersQuery = `
    WITH user_streaks AS (
      SELECT 
        CASE WHEN id1 = $1 THEN id2 ELSE id1 END AS user_id,
        COUNT(DISTINCT DATE("time")) as streak_days
      FROM public.taps
      WHERE "time" >= $2::timestamptz AND "time" < $3::timestamptz
        AND (id1 = $1 OR id2 = $1)
      GROUP BY user_id
      HAVING COUNT(DISTINCT DATE("time")) > 0
    )
    SELECT 
      us.user_id,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username, 'Unknown') AS name,
      us.streak_days
    FROM user_streaks us
    JOIN public.users u ON u.id = us.user_id
    WHERE us.user_id != $1
    ORDER BY us.streak_days DESC
    LIMIT 5
  `;
  
  const streakMastersResult = await db.query(streakMastersQuery, [userId, weekStartStr, weekEndStr]);
  const streakMasters = streakMastersResult.rows.map(row => ({
    user_id: row.user_id,
    name: row.name,
    streak_days: parseInt(row.streak_days)
  }));
  
  // Trace logging for streak masters leaderboard
  if (trace) {
    trace.queries.leaderboard_streak_masters = {
      text: streakMastersQuery,
      params: [userId, weekStartStr, weekEndStr],
      row_count: streakMastersResult.rows.length,
      sample: streakMastersResult.rows.slice(0, 3).map(row => ({
        user_id: row.user_id,
        name: row.name,
        streak_days: parseInt(row.streak_days)
      }))
    };
  }
  
  // 6. Recommendations (simplified mutual connections)
  const recommendationsQuery = `
    WITH direct_connections AS (
      SELECT DISTINCT CASE WHEN id1 = $1 THEN id2 ELSE id1 END AS connected_user_id
      FROM public.taps
      WHERE (id1 = $1 OR id2 = $1)
    ),
    mutual_connections AS (
      SELECT 
        CASE WHEN t.id1 = dc.connected_user_id THEN t.id2 ELSE t.id1 END AS candidate_id,
        COUNT(DISTINCT dc.connected_user_id) as mutual_count,
        ARRAY_AGG(DISTINCT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username)) as mutual_names
      FROM public.taps t
      JOIN direct_connections dc ON (t.id1 = dc.connected_user_id OR t.id2 = dc.connected_user_id)
      JOIN public.users u ON u.id = dc.connected_user_id
      WHERE (t.id1 = dc.connected_user_id OR t.id2 = dc.connected_user_id)
        AND CASE WHEN t.id1 = dc.connected_user_id THEN t.id2 ELSE t.id1 END != $1
        AND NOT EXISTS (
          SELECT 1 FROM direct_connections dc2 
          WHERE dc2.connected_user_id = CASE WHEN t.id1 = dc.connected_user_id THEN t.id2 ELSE t.id1 END
        )
      GROUP BY candidate_id
      HAVING COUNT(DISTINCT dc.connected_user_id) >= 2
    )
    SELECT 
      mc.candidate_id as user_id,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username, 'Unknown') AS name,
      mc.mutual_count,
      mc.mutual_names
    FROM mutual_connections mc
    JOIN public.users u ON mc.candidate_id = u.id
    ORDER BY mc.mutual_count DESC
    LIMIT 3
  `;
  
  const recommendationsResult = await db.query(recommendationsQuery, [userId]);
  const recommendations = recommendationsResult.rows.map(row => ({
    user_id: row.user_id,
    name: row.name,
    scores: { total: Math.min(1, row.mutual_count / 10) },
    mutuals: row.mutual_names || [],
    explain: `Connected through ${row.mutual_count} mutual friends`
  }));
  
  // 7. Check for geohash warnings
  try {
    const geoCheck = await db.query(`
      SELECT COUNT(*) as has_geohash 
      FROM public.taps 
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL 
      LIMIT 1
    `);
    if (geoCheck.rows[0]?.has_geohash === '0') {
      warnings.push('geo_expansion not computed: no geohash in taps');
    }
  } catch (geoError) {
    warnings.push('geo_expansion not computed: no geohash in taps');
  }
  
  // Assemble final payload
  const payload = {
    source: 'db', // Will be overridden by caller
    generated_at: now.toISOString(),
    week: {
      year: currentYear,
      iso_week: currentWeek,
      range: [weekStartStr, weekEndStr]
    },
    recap: {
      first_degree_new: firstDegreeNew,
      second_degree_delta: secondDegreeDelta,
      community_activity: communityActivity,
      geo_expansion: [] // Placeholder
    },
    momentum: {
      current_streak_days: momentum.current_streak_days,
      longest_streak_days: momentum.longest_streak_days,
      weekly_taps: parseInt(momentum.weekly_taps),
      new_connections: firstDegreeNew.length,
      weekly_goal: {
        progress: parseInt(momentum.weekly_taps),
        target_taps: 25
      }
    },
    leaderboard: {
      new_connections: newConnections,
      community_builders: communityBuilders,
      streak_masters: streakMasters
    },
    recommendations: recommendations,
    meta: {
      source: 'db', // Will be overridden by caller
      duration_ms: 0, // Will be set by caller
      user_id: userId,
      watermark: now.toISOString(),
      warnings: warnings
    }
  };
  
  return { payload, trace };
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

function startOfIsoWeek(date, tz) {
  // Get Monday 00:00 in the specified timezone, return as UTC timestamp
  const d = new Date(date);
  
  // Convert to the target timezone
  const tzDate = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const utcDate = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offset = utcDate.getTime() - tzDate.getTime();
  
  // Adjust for timezone offset
  const adjustedDate = new Date(d.getTime() + offset);
  
  // Get Monday of the week (ISO week starts on Monday)
  const dayOfWeek = adjustedDate.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday = 0, so 6 days to Monday
  const monday = new Date(adjustedDate);
  monday.setDate(monday.getDate() - daysToMonday);
  monday.setHours(0, 0, 0, 0);
  
  // Convert back to UTC
  return new Date(monday.getTime() - offset);
}

function endOfIsoWeek(date, tz) {
  // Get next Monday 00:00 in the specified timezone, return as UTC timestamp
  const start = startOfIsoWeek(date, tz);
  const end = new Date(start);
  end.setDate(end.getDate() + 7); // Add 7 days to get next Monday
  return end;
}

module.exports = { assembleWeeklyPayload };
