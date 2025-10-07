// GET /api/community/weekly?user_id=:id
// Weekly Pulse endpoint for Community page
// Date: 2025-01-15

// Use shared database pool
const { getPool } = require('../../lib/db');
const { proxyOr } = require('../../lib/http');
const pool = getPool();

// Local function for direct DB access
const localHandler = async (req, res) => {
  console.log('🚀 COMMUNITY API HANDLER CALLED - NEW VERSION');
  const startTime = Date.now();
  
  // Verify DATABASE_URL format
  console.log('🔍 [weekly] DATABASE_URL present:', !!process.env.DATABASE_URL);
  console.log('🔍 [weekly] DATABASE_URL length:', process.env.DATABASE_URL?.length);
  console.log('🔍 [weekly] DATABASE_URL starts with postgres:', process.env.DATABASE_URL?.startsWith('postgres'));
  
  // Parse DATABASE_URL to verify components
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      console.log('🔍 [weekly] DATABASE_URL components:', {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        username: url.username,
        database: url.pathname.slice(1),
        sslmode: url.searchParams.get('sslmode')
      });
    } catch (urlError) {
      console.error('❌ [weekly] DATABASE_URL parsing failed:', urlError);
    }
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, strict, debug } = req.query;
  const isDebug = debug === '1';
  
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    console.log('📊 Fetching community weekly data from database...');
    
    // Add minimal warm-up ping before complex SQL
    try {
      console.log('🔍 [weekly] Running ping query...');
      const pingStartTime = Date.now();
      await pool.query('SELECT 1');
      const pingTime = Date.now() - pingStartTime;
      console.log(`✅ [weekly] Ping query completed in ${pingTime}ms`);
    } catch (pingError) {
      console.error('❌ [weekly] Database ping failed:', pingError);
      console.error('❌ [weekly] Ping error details:', {
        name: pingError.name,
        message: pingError.message,
        code: pingError.code,
        stack: pingError.stack
      });
      const body = isDebug
        ? { ok: false, source: 'db', code: pingError.code, error: String(pingError.message) }
        : { ok: false };
      return res.status(500).json(body);
    }
    
    // Get database client with error handling
    let client;
    try {
      console.log('🔌 [weekly] Attempting to get client from pool...');
      const clientStartTime = Date.now();
      client = await pool.connect();
      const clientTime = Date.now() - clientStartTime;
      console.log(`✅ [weekly] Client obtained in ${clientTime}ms`);
      console.log('🔍 [weekly] Client process ID:', client?.processID);
      console.log('🔍 [weekly] Client secret key:', client?.secretKey);
    } catch (dbError) {
      console.error('❌ [weekly] Database connection failed:', dbError);
      console.error('❌ [weekly] Connection error details:', {
        name: dbError.name,
        message: dbError.message,
        code: dbError.code,
        stack: dbError.stack
      });
      const body = isDebug
        ? { ok: false, source: 'db', code: dbError.code, error: String(dbError.message) }
        : { ok: false };
      return res.status(500).json(body);
    }
    
    try {
      // Step 1: Explicit checks before main query
      let who, schemas;
      try {
        who = await client.query('SELECT current_user, current_database()');
        schemas = await client.query(`
          SELECT nspname FROM pg_namespace WHERE nspname IN ('public','gamification')
        `);
      } catch (stepError) {
        if (isDebug) {
          return res.status(500).json({
            ok: false,
            at: 'weekly:connect',
            code: stepError.code,
            message: stepError.message,
            detail: stepError.detail || null
          });
        }
        throw stepError;
      }
      
      // Step 2: Test permissions on gamification schema
      try {
        await client.query('SELECT COUNT(*) FROM gamification.user_day_activity');
      } catch (permError) {
        if (permError.code === '42501') {
          console.error('❌ Permission denied on gamification schema:', permError);
          const body = isDebug
            ? { 
                ok: false, 
                at: 'weekly:permissions',
                code: permError.code, 
                message: 'Permission denied on gamification schema',
                detail: permError.detail || null,
                hint: 'DATABASE_URL/SSL/permissions',
                sql: `GRANT USAGE ON SCHEMA gamification TO "${who.rows[0].current_user}"; GRANT SELECT ON ALL TABLES IN SCHEMA gamification TO "${who.rows[0].current_user}"; ALTER DEFAULT PRIVILEGES IN SCHEMA gamification GRANT SELECT ON TABLES TO "${who.rows[0].current_user}";`
              }
            : { ok: false };
          return res.status(500).json(body);
        }
        if (isDebug) {
          return res.status(500).json({
            ok: false,
            at: 'weekly:permissions',
            code: permError.code,
            message: permError.message,
            detail: permError.detail || null
          });
        }
        throw permError;
      }
      
      // Get current week data
      const currentWeek = getISOWeek(new Date());
      const currentYear = new Date().getFullYear();
      
      // Step 3: Query user week activity (schema-qualified)
      let weekActivityResult;
      try {
        const weekActivityQuery = `
          SELECT 
            first_degree_new_count,
            second_degree_count,
            tap_count
          FROM gamification.user_week_activity 
          WHERE user_id = $1 AND iso_week = $2 AND year = $3
        `;
        weekActivityResult = await client.query(weekActivityQuery, [user_id, currentWeek, currentYear]);
      } catch (stepError) {
        if (isDebug) {
          return res.status(500).json({
            ok: false,
            at: 'weekly:week_activity',
            code: stepError.code,
            message: stepError.message,
            detail: stepError.detail || null
          });
        }
        throw stepError;
      }
      
      // Step 4: Query user streaks (schema-qualified)
      let streakResult;
      try {
        const streakQuery = `
          SELECT 
            current_streak_days,
            longest_streak_days
          FROM gamification.user_streaks 
          WHERE user_id = $1
        `;
        streakResult = await client.query(streakQuery, [user_id]);
      } catch (stepError) {
        if (isDebug) {
          return res.status(500).json({
            ok: false,
            at: 'weekly:streaks',
            code: stepError.code,
            message: stepError.message,
            detail: stepError.detail || null
          });
        }
        throw stepError;
      }
      
      // Step 5: Query weekly goal progress (schema-qualified)
      let weekly_goal;
      try {
        const goal = Number(process.env.WEEKLY_GOAL_TAPS || 25);
        const weeklyGoalQuery = `
          SELECT COALESCE(SUM(tap_count), 0) AS progress
          FROM gamification.user_week_activity
          WHERE user_id = $1
            AND year = EXTRACT(isoyear FROM NOW())::int
            AND iso_week = EXTRACT(week FROM NOW())::int
        `;
        const weeklyGoalResult = await client.query(weeklyGoalQuery, [user_id]);
        weekly_goal = { 
          progress: Number(weeklyGoalResult.rows[0]?.progress || 0), 
          target_taps: goal 
        };
      } catch (stepError) {
        if (isDebug) {
          return res.status(500).json({
            ok: false,
            at: 'weekly:goal',
            code: stepError.code,
            message: stepError.message,
            detail: stepError.detail || null
          });
        }
        throw stepError;
      }
      
      // Step 6: Query recent first-degree connections (schema-qualified)
      let connectionsResult;
      try {
        const connectionsQuery = `
          SELECT DISTINCT 
            CASE 
              WHEN t.id1 = $1 THEN t.id2 
              ELSE t.id1 
            END as connected_user_id,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username) as connected_user_name,
            MAX(t."time") as last_tap_at
          FROM public.taps t
          JOIN public.users u ON (
            CASE 
              WHEN t.id1 = $1 THEN u.id = t.id2 
              ELSE u.id = t.id1 
            END
          )
          WHERE (t.id1 = $1 OR t.id2 = $1)
            AND t."time" >= NOW() - INTERVAL '7 days'
          GROUP BY connected_user_id, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username)
          ORDER BY last_tap_at DESC
          LIMIT 10
        `;
        connectionsResult = await client.query(connectionsQuery, [user_id]);
      } catch (stepError) {
        if (isDebug) {
          return res.status(500).json({
            ok: false,
            at: 'weekly:connections',
            code: stepError.code,
            message: stepError.message,
            detail: stepError.detail || null
          });
        }
        throw stepError;
      }
      
      // Check for geo expansion warning
      const warnings = [];
      try {
        const geoCheck = await client.query(`
          SELECT COUNT(*) as has_geohash 
          FROM public.taps 
          WHERE latitude IS NOT NULL AND longitude IS NOT NULL 
          LIMIT 1
        `);
        if (geoCheck.rows[0]?.has_geohash === '0') {
          warnings.push('geo_expansion not computed: no geohash in taps');
        }
      } catch (geoError) {
        console.warn('Could not check for geohash data:', geoError.message);
        warnings.push('geo_expansion not computed: no geohash in taps');
      }

      // Add debug information
      const hasDbUrl = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres'));
      
      // Build the weekly data structure with guaranteed arrays
      const weeklyData = {
        source: "db",
        generated_at: new Date().toISOString(),
        debug: isDebug ? {
          dbUrlPresent: hasDbUrl,
          whoami: who.rows[0],
          schemas: schemas.rows.map(r => r.nspname),
          sql: {
            community_activity: `SELECT day, COALESCE(SUM(tap_count), 0)::int AS taps FROM gamification.user_day_activity WHERE day >= $1::date AND day <= $2::date GROUP BY day ORDER BY day DESC LIMIT 7`,
            new_connections: `WITH new_connections AS (SELECT CASE WHEN t.id1 = $1 THEN t.id2 ELSE t.id1 END as connected_user_id, MAX(t."time") as last_tap_at, COUNT(*) as new_first_degree FROM public.taps t WHERE (t.id1 = $1 OR t.id2 = $1) AND t."time" >= DATE_TRUNC('week', CURRENT_DATE)::date AND t."time" < DATE_TRUNC('week', CURRENT_DATE)::date + INTERVAL '1 week' GROUP BY connected_user_id HAVING COUNT(*) > 0) SELECT nc.connected_user_id as user_id, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username) as name, nc.new_first_degree, nc.last_tap_at FROM new_connections nc JOIN public.users u ON nc.connected_user_id = u.id WHERE nc.connected_user_id != $1 ORDER BY nc.new_first_degree DESC, nc.last_tap_at DESC LIMIT 5`,
            community_builders: `WITH weekly_taps AS (SELECT CASE WHEN t.id1 = $1 THEN t.id2 ELSE t.id1 END as user_id, COUNT(*) as weekly_taps FROM public.taps t WHERE (t.id1 = $1 OR t.id2 = $1) AND t."time" >= CURRENT_DATE - INTERVAL '7 days' GROUP BY user_id HAVING COUNT(*) > 0) SELECT wt.user_id, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username) as name, wt.weekly_taps FROM weekly_taps wt JOIN public.users u ON wt.user_id = u.id WHERE wt.user_id != $1 ORDER BY wt.weekly_taps DESC LIMIT 5`,
            streak_masters: `WITH user_streaks AS (SELECT CASE WHEN t.id1 = $1 THEN t.id2 ELSE t.id1 END as user_id, COUNT(DISTINCT DATE(t."time")) as streak_days FROM public.taps t WHERE (t.id1 = $1 OR t.id2 = $1) AND t."time" >= CURRENT_DATE - INTERVAL '30 days' GROUP BY user_id HAVING COUNT(DISTINCT DATE(t."time")) > 0) SELECT us.user_id, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username) as name, us.streak_days FROM user_streaks us JOIN public.users u ON us.user_id = u.id WHERE us.user_id != $1 ORDER BY us.streak_days DESC LIMIT 5`,
            recommendations: `WITH direct_connections AS (SELECT DISTINCT CASE WHEN t.id1 = $1 THEN t.id2 ELSE t.id1 END AS connected_user_id FROM public.taps t WHERE (t.id1 = $1 OR t.id2 = $1)), mutual_connections AS (SELECT CASE WHEN t.id1 = dc.connected_user_id THEN t.id2 ELSE t.id1 END AS candidate_id, COUNT(DISTINCT dc.connected_user_id) as mutual_count, ARRAY_AGG(DISTINCT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username)) as mutual_names FROM public.taps t JOIN direct_connections dc ON (t.id1 = dc.connected_user_id OR t.id2 = dc.connected_user_id) JOIN public.users u ON u.id = dc.connected_user_id WHERE (t.id1 = dc.connected_user_id OR t.id2 = dc.connected_user_id) AND CASE WHEN t.id1 = dc.connected_user_id THEN t.id2 ELSE t.id1 END != $1 AND NOT EXISTS (SELECT 1 FROM direct_connections dc2 WHERE dc2.connected_user_id = CASE WHEN t.id1 = dc.connected_user_id THEN t.id2 ELSE t.id1 END) GROUP BY candidate_id HAVING COUNT(DISTINCT dc.connected_user_id) >= 2) SELECT mc.candidate_id as user_id, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username) as name, mc.mutual_count, mc.mutual_names FROM mutual_connections mc JOIN public.users u ON mc.candidate_id = u.id ORDER BY mc.mutual_count DESC LIMIT 3`
          }
        } : undefined,
        week: {
          year: currentYear,
          iso_week: currentWeek,
          range: [getWeekStart(new Date()).toISOString().split('T')[0], getWeekEnd(new Date()).toISOString().split('T')[0]]
        },
        recap: {
          first_degree_new: connectionsResult.rows.map(row => ({
            user_id: row.connected_user_id,
            name: row.connected_user_name,
            last_tap_at: row.last_tap_at
          })),
          second_degree_delta: weekActivityResult.rows[0]?.second_degree_count || 0,
          community_activity: await getCommunityActivity(client, currentWeek, currentYear),
          geo_expansion: [] // Placeholder until geohash exists
        },
        momentum: {
          current_streak_days: streakResult.rows[0]?.current_streak_days || 0,
          longest_streak_days: streakResult.rows[0]?.longest_streak_days || 0,
          weekly_taps: weekActivityResult.rows[0]?.tap_count || 0,
          new_connections: weekActivityResult.rows[0]?.first_degree_new_count || 0,
          weekly_goal: weekly_goal
        },
        leaderboard: {
          new_connections: await getNewConnectionsLeaderboard(client, user_id, currentWeek, currentYear),
          community_builders: await getCommunityBuildersLeaderboard(client, user_id, currentWeek, currentYear),
          streak_masters: await getStreakMastersLeaderboard(client, user_id)
        },
        recommendations: await getRecommendations(client, user_id),
        meta: {
          source: 'db',
          duration_ms: Date.now() - startTime,
          user_id: user_id,
          watermark: new Date().toISOString(),
          warnings: warnings
        }
      };

      // Ensure all arrays are always present (even if empty)
      weeklyData.leaderboard = weeklyData.leaderboard ?? {};
      weeklyData.leaderboard.new_connections = Array.isArray(weeklyData.leaderboard.new_connections) ? weeklyData.leaderboard.new_connections : [];
      weeklyData.leaderboard.community_builders = Array.isArray(weeklyData.leaderboard.community_builders) ? weeklyData.leaderboard.community_builders : [];
      weeklyData.leaderboard.streak_masters = Array.isArray(weeklyData.leaderboard.streak_masters) ? weeklyData.leaderboard.streak_masters : [];
      
      weeklyData.momentum = weeklyData.momentum ?? {};
      weeklyData.momentum.weekly_goal = weeklyData.momentum.weekly_goal ?? { progress: 0, target_taps: 25 };
      
      weeklyData.recap = weeklyData.recap ?? {};
      weeklyData.recap.first_degree_new = Array.isArray(weeklyData.recap.first_degree_new) ? weeklyData.recap.first_degree_new : [];
      weeklyData.recap.community_activity = Array.isArray(weeklyData.recap.community_activity) ? weeklyData.recap.community_activity : [];
      weeklyData.recap.geo_expansion = Array.isArray(weeklyData.recap.geo_expansion) ? weeklyData.recap.geo_expansion : [];
      
      weeklyData.recommendations = Array.isArray(weeklyData.recommendations) ? weeklyData.recommendations : [];

      // Set no-cache headers
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Content-Type', 'application/json');
      
      console.log('✅ Successfully fetched community data from database');
      return res.status(200).json(weeklyData);

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Error fetching community data from database:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    
    // Return proper JSON error response with debug info
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Content-Type', 'application/json');
    const body = isDebug
      ? { 
          ok: false, 
          source: 'db', 
          code: error.code, 
          error: String(error.message),
          hint: 'DATABASE_URL/SSL/permissions'
        }
      : { ok: false };
    return res.status(500).json(body);
  }
};

// Normalize raw taps data from reader service to weekly payload structure
function normalizeWeeklyFromTaps(taps, userId) {
  const warnings = [];
  const now = new Date();
  const currentWeek = getISOWeek(now);
  const currentYear = now.getFullYear();
  
  // Get week start and end dates (Monday to Sunday UTC)
  const weekStart = getWeekStart(now);
  const weekEnd = getWeekEnd(now);
  
  // Filter taps for current week and user
  const weekTaps = taps.filter(tap => {
    const tapDate = new Date(tap.time || tap.timestamp);
    return tapDate >= weekStart && tapDate <= weekEnd && 
           (tap.id1 === userId || tap.id2 === userId);
  });
  
  // Get all unique counterparties for this week
  const counterparties = new Set();
  const firstDegreeNew = [];
  const dailyTaps = {};
  
  weekTaps.forEach(tap => {
    const otherUserId = tap.id1 === userId ? tap.id2 : tap.id1;
    counterparties.add(otherUserId);
    
    // Track daily activity
    const day = new Date(tap.time || tap.timestamp).toISOString().split('T')[0];
    dailyTaps[day] = (dailyTaps[day] || 0) + 1;
    
    // Track new connections (simplified - just take latest per counterparty)
    const existing = firstDegreeNew.find(conn => conn.user_id === otherUserId);
    if (!existing) {
      firstDegreeNew.push({
        user_id: otherUserId,
        name: tap.other_user_name || `User ${otherUserId.slice(0, 8)}`,
        last_tap_at: tap.time || tap.timestamp
      });
    }
  });
  
  // Build community activity array
  const communityActivity = [];
  for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
    const day = d.toISOString().split('T')[0];
    communityActivity.push({
      day: day,
      taps: dailyTaps[day] || 0
    });
  }
  
  // Calculate weekly taps and new connections
  const weeklyTaps = weekTaps.length;
  const newConnections = counterparties.size;
  
  // Simple streak calculation (placeholder)
  const currentStreakDays = Math.min(7, Math.floor(weeklyTaps / 3)); // Rough estimate
  const longestStreakDays = Math.max(currentStreakDays, 0);
  
  // Build leaderboards (simplified)
  const allUsers = new Map();
  taps.forEach(tap => {
    const user1 = tap.id1;
    const user2 = tap.id2;
    const tapTime = new Date(tap.time || tap.timestamp);
    
    if (tapTime >= weekStart && tapTime <= weekEnd) {
      // Count weekly taps for all users
      allUsers.set(user1, (allUsers.get(user1) || 0) + 1);
      allUsers.set(user2, (allUsers.get(user2) || 0) + 1);
    }
  });
  
  // Top community builders (by tap count)
  const communityBuilders = Array.from(allUsers.entries())
    .filter(([userId, count]) => userId !== userId && count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([userId, count]) => ({
      user_id: userId,
      name: `User ${userId.slice(0, 8)}`,
      weekly_taps: count
    }));
  
  return {
    source: 'reader',
    generated_at: now.toISOString(),
    week: {
      year: currentYear,
      iso_week: currentWeek,
      range: [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]
    },
    recap: {
      first_degree_new: firstDegreeNew.slice(0, 10),
      second_degree_delta: 0, // Placeholder
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
      new_connections: firstDegreeNew.slice(0, 5).map(conn => ({
        user_id: conn.user_id,
        name: conn.name,
        new_first_degree: 1, // Simplified
        last_tap_at: conn.last_tap_at
      })),
      community_builders: communityBuilders,
      streak_masters: [] // Placeholder
    },
    recommendations: [], // Placeholder
    meta: {
      source: 'reader',
      duration_ms: 0, // Will be set by handler
      user_id: userId,
      watermark: now.toISOString(),
      warnings: warnings
    }
  };
}

// Main handler that uses smart proxy with normalization
const handler = async (req, res) => {
  const startTime = Date.now();
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  // Create a custom proxy function that handles normalization
  const customProxy = async (localFn, path, req, res) => {
    if (process.env.DATA_READER_URL) {
      try {
        console.log(`🔄 [proxy] Using reader service: ${process.env.DATA_READER_URL}${path}`);
        
        // Build URL with query parameters
        const url = new URL(`${process.env.DATA_READER_URL}${path}`);
        Object.keys(req.query).forEach(key => {
          url.searchParams.set(key, req.query[key]);
        });
        
        // Make request to reader service
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'x-data-key': process.env.DATA_READER_SECRET || '',
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        const data = await response.json();
        
        // Check if response has taps array (raw data) or is already normalized
        if (data.taps && Array.isArray(data.taps)) {
          console.log(`🔄 [proxy] Normalizing ${data.taps.length} taps from reader service`);
          const normalizedData = normalizeWeeklyFromTaps(data.taps, user_id);
          normalizedData.meta.duration_ms = Date.now() - startTime;
          
          res.status(200);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
          return res.json(normalizedData);
        } else {
          // Already normalized, pass through
          console.log(`🔄 [proxy] Reader returned normalized data, passing through`);
          res.status(response.status);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
          return res.json(data);
        }
        
      } catch (error) {
        console.error(`❌ [proxy] Reader service failed: ${error.message}`);
        console.log(`🔄 [proxy] Falling back to direct DB access`);
        return await localFn(req, res);
      }
    } else {
      // No DATA_READER_URL, use local function
      console.log(`🔄 [proxy] Using direct DB access (no DATA_READER_URL)`);
      return await localFn(req, res);
    }
  };

  // Use custom proxy with normalization
  await customProxy(localHandler, '/community/weekly', req, res);
  
  const duration = Date.now() - startTime;
  const mode = process.env.DATA_READER_URL ? 'reader' : 'direct';
  console.log(`📊 [community/weekly] mode=${mode} duration=${duration}ms`);
};

handler.config = { runtime: 'nodejs' };
module.exports = handler;

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

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getWeekEnd(date) {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end;
}


// Recommendations query function - simple mutual connections algorithm
async function getRecommendations(client, user_id) {
  try {
    // EXPLAIN: Find users with ≥2 mutual connections, not already first-degree
    // Consider index on: public.taps("time", id1, id2) for performance
    const query = `
      WITH direct_connections AS (
        SELECT DISTINCT CASE WHEN t.id1 = $1 THEN t.id2 ELSE t.id1 END AS connected_user_id
        FROM public.taps t
        WHERE (t.id1 = $1 OR t.id2 = $1)
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
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username) as name,
        mc.mutual_count,
        mc.mutual_names
      FROM mutual_connections mc
      JOIN public.users u ON mc.candidate_id = u.id
      ORDER BY mc.mutual_count DESC
      LIMIT 3
    `;
    const result = await client.query(query, [user_id]);
    return result.rows.map(row => ({
      user_id: row.user_id,
      name: row.name,
      scores: { total: Number(row.mutual_count || 0) / 10 }, // Normalize to 0-1 range
      mutuals: row.mutual_names || [],
      explain: `Connected through ${row.mutual_count} mutual friends`
    }));
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    return [];
  }
}

// Community activity query function - daily taps for current ISO week
async function getCommunityActivity(client, currentWeek, currentYear) {
  try {
    // Get week start and end dates for current ISO week
    const weekStart = getWeekStart(new Date());
    const weekEnd = getWeekEnd(new Date());
    
    // EXPLAIN: This query aggregates daily tap counts for the current week
    // Consider index on: gamification.user_day_activity(day) for performance
    const query = `
      SELECT 
        day,
        COALESCE(SUM(tap_count), 0)::int AS taps
      FROM gamification.user_day_activity
      WHERE day >= $1::date AND day <= $2::date
      GROUP BY day
      ORDER BY day DESC
      LIMIT 7
    `;
    const result = await client.query(query, [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]);
    return result.rows.map(row => ({
      day: row.day,
      taps: row.taps
    }));
  } catch (error) {
    console.error('Error fetching community activity:', error);
    return [];
  }
}

// Leaderboard query functions - direct queries from public tables
async function getNewConnectionsLeaderboard(client, user_id, currentWeek, currentYear) {
  try {
    // EXPLAIN: Find users who formed new first-degree connections this week
    // Consider index on: public.taps("time", id1, id2) for performance
    const query = `
      WITH new_connections AS (
        SELECT 
          CASE WHEN t.id1 = $1 THEN t.id2 ELSE t.id1 END as connected_user_id,
          MAX(t."time") as last_tap_at,
          COUNT(*) as new_first_degree
        FROM public.taps t
        WHERE (t.id1 = $1 OR t.id2 = $1)
          AND t."time" >= DATE_TRUNC('week', CURRENT_DATE)::date
          AND t."time" < DATE_TRUNC('week', CURRENT_DATE)::date + INTERVAL '1 week'
        GROUP BY connected_user_id
        HAVING COUNT(*) > 0
      )
      SELECT 
        nc.connected_user_id as user_id,
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username) as name,
        nc.new_first_degree,
        nc.last_tap_at
      FROM new_connections nc
      JOIN public.users u ON nc.connected_user_id = u.id
      WHERE nc.connected_user_id != $1
      ORDER BY nc.new_first_degree DESC, nc.last_tap_at DESC
      LIMIT 5
    `;
    const result = await client.query(query, [user_id]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching new connections leaderboard:', error);
    return [];
  }
}

async function getCommunityBuildersLeaderboard(client, user_id, currentWeek, currentYear) {
  try {
    // EXPLAIN: Find users with most taps in the last 7 days
    // Consider index on: public.taps("time", id1, id2) for performance
    const query = `
      WITH weekly_taps AS (
        SELECT 
          CASE WHEN t.id1 = $1 THEN t.id2 ELSE t.id1 END as user_id,
          COUNT(*) as weekly_taps
        FROM public.taps t
        WHERE (t.id1 = $1 OR t.id2 = $1)
          AND t."time" >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY user_id
        HAVING COUNT(*) > 0
      )
      SELECT 
        wt.user_id,
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username) as name,
        wt.weekly_taps
      FROM weekly_taps wt
      JOIN public.users u ON wt.user_id = u.id
      WHERE wt.user_id != $1
      ORDER BY wt.weekly_taps DESC
      LIMIT 5
    `;
    const result = await client.query(query, [user_id]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching community builders leaderboard:', error);
    return [];
  }
}

async function getStreakMastersLeaderboard(client, user_id) {
  try {
    // EXPLAIN: Find users with longest active streaks (simplified calculation)
    // Consider index on: public.taps("time", id1, id2) for performance
    const query = `
      WITH user_streaks AS (
        SELECT 
          CASE WHEN t.id1 = $1 THEN t.id2 ELSE t.id1 END as user_id,
          COUNT(DISTINCT DATE(t."time")) as streak_days
        FROM public.taps t
        WHERE (t.id1 = $1 OR t.id2 = $1)
          AND t."time" >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY user_id
        HAVING COUNT(DISTINCT DATE(t."time")) > 0
      )
      SELECT 
        us.user_id,
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username) as name,
        us.streak_days
      FROM user_streaks us
      JOIN public.users u ON us.user_id = u.id
      WHERE us.user_id != $1
      ORDER BY us.streak_days DESC
      LIMIT 5
    `;
    const result = await client.query(query, [user_id]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching streak masters leaderboard:', error);
    return [];
  }
}