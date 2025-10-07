// lib/weekly/assembleWeeklyPayload.ts
// Weekly payload assembler for Community API
// Date: 2025-01-15

interface WeeklyPayload {
  source: string;
  generated_at: string;
  week: {
    year: number;
    iso_week: number;
    range: [string, string];
  };
  recap: {
    first_degree_new: Array<{
      user_id: string;
      name: string;
      last_tap_at: string;
    }>;
    second_degree_delta: number;
    community_activity: Array<{
      day: string;
      taps: number;
    }>;
    geo_expansion: Array<{
      city: string;
      new_taps: number;
    }>;
  };
  momentum: {
    current_streak_days: number;
    longest_streak_days: number;
    weekly_taps: number;
    new_connections: number;
    weekly_goal: {
      progress: number;
      target_taps: number;
    };
  };
  leaderboard: {
    new_connections: Array<{
      user_id: string;
      name: string;
      new_first_degree: number;
      last_tap_at: string;
    }>;
    community_builders: Array<{
      user_id: string;
      name: string;
      delta_second_degree: number;
    }>;
    streak_masters: Array<{
      user_id: string;
      name: string;
      streak_days: number;
    }>;
  };
  recommendations: Array<{
    user_id: string;
    name: string;
    scores: {
      total: number;
    };
    mutuals: string[];
    explain: string;
  }>;
  meta: {
    source: string;
    duration_ms: number;
    user_id: string;
    watermark: string;
    warnings: string[];
  };
}

export async function assembleWeeklyPayload(db: any, userId: string): Promise<WeeklyPayload> {
  const now = new Date();
  const currentWeek = getISOWeek(now);
  const currentYear = now.getFullYear();
  const weekStart = getWeekStart(now);
  const weekEnd = getWeekEnd(now);
  
  const warnings: string[] = [];
  
  // Get current week range
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const weekEndStr = weekEnd.toISOString().split('T')[0];
  
  // 1. First degree new connections (recap)
  const firstDegreeNewQuery = `
    WITH wk AS (
      SELECT *
      FROM public.taps
      WHERE "time" >= date_trunc('week', now()) AND "time" < date_trunc('week', now()) + interval '7 days'
        AND (id1 = $1 OR id2 = $1)
    ), parties AS (
      SELECT CASE WHEN id1 = $1 THEN id2 ELSE id1 END AS other_id,
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
  
  const firstDegreeResult = await db.query(firstDegreeNewQuery, [userId]);
  const firstDegreeNew = firstDegreeResult.rows.map(row => ({
    user_id: row.user_id,
    name: row.name,
    last_tap_at: row.last_tap_at
  }));
  
  // 2. Second degree delta (simplified - count of new connections this week)
  const secondDegreeDelta = firstDegreeNew.length;
  
  // 3. Community activity (daily tap counts for current week)
  const communityActivityQuery = `
    SELECT 
      DATE("time") as day,
      COUNT(*) as taps
    FROM public.taps
    WHERE "time" >= $1::date AND "time" <= $2::date
    GROUP BY DATE("time")
    ORDER BY day DESC
  `;
  
  const communityActivityResult = await db.query(communityActivityQuery, [weekStartStr, weekEndStr]);
  const communityActivity = communityActivityResult.rows.map(row => ({
    day: row.day,
    taps: parseInt(row.taps)
  }));
  
  // 4. Momentum calculations
  const momentumQuery = `
    WITH user_taps AS (
      SELECT "time"
      FROM public.taps
      WHERE (id1 = $1 OR id2 = $1)
        AND "time" >= date_trunc('week', now())
        AND "time" < date_trunc('week', now()) + interval '7 days'
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
  
  const momentumResult = await db.query(momentumQuery, [userId]);
  const momentum = momentumResult.rows[0];
  
  // 5. Leaderboards
  // New connections leaderboard
  const newConnectionsQuery = `
    WITH wk AS (
      SELECT *
      FROM public.taps
      WHERE "time" >= date_trunc('week', now()) AND "time" < date_trunc('week', now()) + interval '7 days'
    ), user_connections AS (
      SELECT 
        CASE WHEN id1 = $1 THEN id2 ELSE id1 END AS other_id,
        COUNT(*) as new_first_degree,
        MAX("time") as last_tap_at
      FROM wk
      WHERE (id1 = $1 OR id2 = $1)
      GROUP BY other_id
    )
    SELECT 
      uc.other_id as user_id,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username, 'Unknown') AS name,
      uc.new_first_degree,
      uc.last_tap_at
    FROM user_connections uc
    JOIN public.users u ON u.id = uc.other_id
    WHERE uc.other_id != $1
    ORDER BY uc.new_first_degree DESC, uc.last_tap_at DESC
    LIMIT 5
  `;
  
  const newConnectionsResult = await db.query(newConnectionsQuery, [userId]);
  const newConnections = newConnectionsResult.rows.map(row => ({
    user_id: row.user_id,
    name: row.name,
    new_first_degree: parseInt(row.new_first_degree),
    last_tap_at: row.last_tap_at
  }));
  
  // Community builders leaderboard
  const communityBuildersQuery = `
    WITH weekly_taps AS (
      SELECT 
        CASE WHEN id1 = $1 THEN id2 ELSE id1 END AS user_id,
        COUNT(*) as tap_count
      FROM public.taps
      WHERE "time" >= date_trunc('week', now()) AND "time" < date_trunc('week', now()) + interval '7 days'
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
  
  const communityBuildersResult = await db.query(communityBuildersQuery, [userId]);
  const communityBuilders = communityBuildersResult.rows.map(row => ({
    user_id: row.user_id,
    name: row.name,
    delta_second_degree: parseInt(row.delta_second_degree)
  }));
  
  // Streak masters leaderboard (simplified)
  const streakMastersQuery = `
    WITH user_streaks AS (
      SELECT 
        CASE WHEN id1 = $1 THEN id2 ELSE id1 END AS user_id,
        COUNT(DISTINCT DATE("time")) as streak_days
      FROM public.taps
      WHERE "time" >= date_trunc('week', now()) AND "time" < date_trunc('week', now()) + interval '7 days'
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
  
  const streakMastersResult = await db.query(streakMastersQuery, [userId]);
  const streakMasters = streakMastersResult.rows.map(row => ({
    user_id: row.user_id,
    name: row.name,
    streak_days: parseInt(row.streak_days)
  }));
  
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
  const payload: WeeklyPayload = {
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
  
  return payload;
}

// Helper functions
function getISOWeek(date: Date): number {
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

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end;
}
