// GET /api/community/weekly?user_id=:id
// Weekly Pulse endpoint for Community page
// Date: 2025-01-15

import { Pool } from 'pg';

// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';

// Use exact same DB client pattern as data-export.js (Vercel-friendly)
let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 1,
    });
  }
  return pool;
}

export default async function handler(req, res) {
  console.log('🚀 COMMUNITY API HANDLER CALLED - NEW VERSION');
  const startTime = Date.now();
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, strict } = req.query;
  
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    console.log('📊 Fetching community weekly data from database...');
    
    // Get database pool
    const dbPool = getPool();
    const client = await dbPool.connect();
    
    try {
      // Get current week data
      const currentWeek = getISOWeek(new Date());
      const currentYear = new Date().getFullYear();
      
      // Query user week activity (schema-qualified)
      const weekActivityQuery = `
        SELECT 
          first_degree_new_count,
          second_degree_count,
          tap_count
        FROM gamification.user_week_activity 
        WHERE user_id = $1 AND iso_week = $2 AND year = $3
      `;
      const weekActivityResult = await client.query(weekActivityQuery, [user_id, currentWeek, currentYear]);
      
      // Query user streaks (schema-qualified)
      const streakQuery = `
        SELECT 
          current_streak_days,
          longest_streak_days
        FROM gamification.user_streaks 
        WHERE user_id = $1
      `;
      const streakResult = await client.query(streakQuery, [user_id]);
      
      // Query weekly goal progress (schema-qualified)
      const goal = Number(process.env.WEEKLY_GOAL_TAPS || 25);
      const weeklyGoalQuery = `
        SELECT COALESCE(SUM(tap_count), 0) AS progress
        FROM gamification.user_week_activity
        WHERE user_id = $1
          AND year = EXTRACT(isoyear FROM NOW())::int
          AND iso_week = EXTRACT(week FROM NOW())::int
      `;
      const weeklyGoalResult = await client.query(weeklyGoalQuery, [user_id]);
      const weekly_goal = { 
        progress: Number(weeklyGoalResult.rows[0]?.progress || 0), 
        target_taps: goal 
      };
      
      // Query recent first-degree connections (schema-qualified)
      const connectionsQuery = `
        SELECT DISTINCT 
          CASE 
            WHEN t.id1 = $1 THEN t.id2 
            ELSE t.id1 
          END as connected_user_id,
          u.name as connected_user_name,
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
        GROUP BY connected_user_id, connected_user_name
        ORDER BY last_tap_at DESC
        LIMIT 10
      `;
      const connectionsResult = await client.query(connectionsQuery, [user_id]);
      
      // Build the weekly data structure with null-safety
      const weeklyData = {
        generated_at: new Date().toISOString(),
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
          warnings: ['geo_expansion not computed: no geohash in taps']
        }
      };

      // Add comprehensive null-safety guards
      weeklyData.leaderboard = weeklyData.leaderboard ?? {};
      weeklyData.leaderboard.new_connections = Array.isArray(weeklyData.leaderboard.new_connections) ? weeklyData.leaderboard.new_connections : [];
      weeklyData.leaderboard.community_builders = Array.isArray(weeklyData.leaderboard.community_builders) ? weeklyData.leaderboard.community_builders : [];
      weeklyData.leaderboard.streak_masters = Array.isArray(weeklyData.leaderboard.streak_masters) ? weeklyData.leaderboard.streak_masters : [];
      
      weeklyData.momentum = weeklyData.momentum ?? {};
      weeklyData.momentum.weekly_goal = weeklyData.momentum.weekly_goal ?? { progress: 0, target_taps: 10 };
      
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
        
        // Support ?strict=db to disable mock fallback
        if (strict === 'db') {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Content-Type', 'application/json');
          return res.status(502).json({ 
            error: 'database_unavailable',
            message: 'Database connection failed and strict mode enabled',
            meta: {
              source: 'db-error',
              duration_ms: Date.now() - startTime,
              user_id: user_id,
              watermark: new Date().toISOString(),
              error: error.message
            }
          });
        }
        
        // For non-strict mode, return 502 with error details
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Content-Type', 'application/json');
        return res.status(502).json({
          error: 'database_unavailable',
          message: 'Database connection failed',
          meta: {
            source: 'db-error',
            duration_ms: Date.now() - startTime,
            user_id: user_id,
            watermark: new Date().toISOString(),
            error: error.message
          }
        });
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


// Recommendations query function - 2-hop edge strength
async function getRecommendations(client, user_id) {
  try {
    const query = `
      WITH direct AS (
        SELECT CASE WHEN u1 = $1 THEN u2 ELSE u1 END AS nbr
        FROM gamification.edge_strength
        WHERE u1 = $1 OR u2 = $1
      ),
      two_hop AS (
        SELECT
          CASE WHEN es2.u1 = d.nbr THEN es2.u2 ELSE es2.u1 END AS candidate,
          MAX(es1.strength_f32 * es2.strength_f32) AS score
        FROM gamification.edge_strength es1
        JOIN direct d
          ON (es1.u1 = $1 AND es1.u2 = d.nbr) OR (es1.u2 = $1 AND es1.u1 = d.nbr)
        JOIN gamification.edge_strength es2
          ON es2.u1 = d.nbr OR es2.u2 = d.nbr
        WHERE NOT (
          (es2.u1 = $1) OR (es2.u2 = $1)
        )
        GROUP BY candidate
      ),
      filtered AS (
        SELECT t.candidate, t.score
        FROM two_hop t
        WHERE NOT EXISTS (
          SELECT 1 FROM direct d2 WHERE d2.nbr = t.candidate
        )
      )
      SELECT
        f.candidate AS user_id,
        f.score,
        u.first_name, u.last_name, u.username, u.pfp_url
      FROM filtered f
      JOIN public.users u ON u.id = f.user_id
      ORDER BY f.score DESC
      LIMIT 5
    `;
    const result = await client.query(query, [user_id]);
    return result.rows.map(row => ({
      user_id: row.user_id,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.username || 'User',
      scores: { total: Number(row.score || 0) },
      mutuals: [], // optional: fill later
      explain: 'High-strength second-degree connection'
    }));
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    return [];
  }
}

// Community activity query function
async function getCommunityActivity(client, currentWeek, currentYear) {
  try {
    // Get week start and end dates
    const weekStart = getWeekStart(new Date());
    const weekEnd = getWeekEnd(new Date());
    
    const query = `
      SELECT 
        day,
        SUM(tap_count)::int AS taps
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

// Leaderboard query functions - using pre-calculated weekly_leaderboard data
async function getNewConnectionsLeaderboard(client, user_id, currentWeek, currentYear) {
  try {
    const query = `
      SELECT 
        u.id as user_id,
        u.name,
        wl.new_first_degree
      FROM gamification.weekly_leaderboard wl
      JOIN public.users u ON wl.user_id = u.id
      WHERE wl.iso_week = $2 AND wl.year = $3
        AND wl.user_id != $1
        AND wl.new_first_degree > 0
      ORDER BY wl.new_first_degree DESC
      LIMIT 10
    `;
    const result = await client.query(query, [user_id, currentWeek, currentYear]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching new connections leaderboard:', error);
    return [];
  }
}

async function getCommunityBuildersLeaderboard(client, user_id, currentWeek, currentYear) {
  try {
    const query = `
      SELECT 
        u.id as user_id,
        u.name,
        wl.delta_second_degree
      FROM gamification.weekly_leaderboard wl
      JOIN public.users u ON wl.user_id = u.id
      WHERE wl.iso_week = $2 AND wl.year = $3
        AND wl.user_id != $1
        AND wl.delta_second_degree > 0
      ORDER BY wl.delta_second_degree DESC
      LIMIT 10
    `;
    const result = await client.query(query, [user_id, currentWeek, currentYear]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching community builders leaderboard:', error);
    return [];
  }
}

async function getStreakMastersLeaderboard(client, user_id) {
  try {
    const query = `
      SELECT 
        u.id as user_id,
        u.name,
        wl.streak_days
      FROM gamification.weekly_leaderboard wl
      JOIN public.users u ON wl.user_id = u.id
      WHERE wl.user_id != $1
        AND wl.streak_days > 0
      ORDER BY wl.streak_days DESC
      LIMIT 10
    `;
    const result = await client.query(query, [user_id]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching streak masters leaderboard:', error);
    return [];
  }
}