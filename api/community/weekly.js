// GET /api/community/weekly?user_id=:id
// Weekly Pulse endpoint for Community page
// Date: 2025-01-15

import { Pool } from 'pg';

// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';

// Use same DB client pattern as data-export.js (Vercel-friendly)
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
          community_activity: [], // TODO: Implement community detection
          geo_expansion: [] // TODO: Implement geo expansion
        },
        momentum: {
          current_streak_days: streakResult.rows[0]?.current_streak_days || 0,
          longest_streak_days: streakResult.rows[0]?.longest_streak_days || 0,
          weekly_taps: weekActivityResult.rows[0]?.tap_count || 0,
          new_connections: weekActivityResult.rows[0]?.first_degree_new_count || 0,
          weekly_goal: weekly_goal
        },
        leaderboard: {
          new_connections: [], // TODO: Implement leaderboard queries
          community_builders: [],
          streak_masters: []
        },
        recommendations: [], // TODO: Implement recommendation algorithm
        meta: {
          source: 'db',
          duration_ms: Date.now() - startTime,
          user_id: user_id,
          watermark: new Date().toISOString()
        }
      };

      // Add null-safety guards
      weeklyData.leaderboard = weeklyData.leaderboard ?? { new_connections: [], community_builders: [], streak_masters: [] };
      weeklyData.momentum = weeklyData.momentum ?? { weekly_goal: { progress: 0, target_taps: 10 } };
      weeklyData.recap = weeklyData.recap ?? { first_degree_new: [], second_degree_delta: 0, community_activity: [], geo_expansion: [] };

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
      return res.status(502).json({ 
        error: 'database_unavailable',
        message: 'Database connection failed and strict mode enabled'
      });
    }
    
    // Fallback to mock data with meta information
    console.log('📊 Database error, returning mock data as fallback');
    const mockData = getMockWeeklyData();
    mockData.meta = {
      source: 'mock',
      duration_ms: Date.now() - startTime,
      user_id: user_id,
      watermark: new Date().toISOString(),
      error: error.message
    };
    
    // Set no-cache headers for mock data too
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Content-Type', 'application/json');
    
    return res.status(200).json(mockData);
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

// Mock data function for when database is not available
function getMockWeeklyData() {
  return {
    generated_at: new Date().toISOString(),
    week: {
      year: new Date().getFullYear(),
      iso_week: getISOWeek(new Date()),
      range: [getWeekStart(new Date()).toISOString().split('T')[0], getWeekEnd(new Date()).toISOString().split('T')[0]]
    },
    recap: {
      first_degree_new: [
        { user_id: "u123", name: "Grace Brown", last_tap_at: "2025-01-15T18:12:00Z" },
        { user_id: "u456", name: "Owen Chen", last_tap_at: "2025-01-14T14:30:00Z" },
        { user_id: "u789", name: "Mia Rodriguez", last_tap_at: "2025-01-13T09:45:00Z" }
      ],
      second_degree_delta: 22,
      community_activity: [
        { community_id: "c7", name: "Nashville Founders", tap_count: 31, unique_users: 14 },
        { community_id: "c12", name: "Austin Tech", tap_count: 28, unique_users: 11 },
        { community_id: "c3", name: "Dallas Entrepreneurs", tap_count: 24, unique_users: 9 }
      ],
      geo_expansion: [
        { city: "Austin", new_taps: 5 },
        { city: "Nashville", new_taps: 3 },
        { city: "Dallas", new_taps: 2 }
      ]
    },
    momentum: {
      current_streak: 7,
      longest_streak: 23,
      weekly_taps: 47,
      new_connections: 8
    },
    leaderboard: {
      new_connections: [
        { user_id: "u1", name: "Alex Johnson", count: 12, rank: 1 },
        { user_id: "u2", name: "Sarah Chen", count: 10, rank: 2 },
        { user_id: "u3", name: "Mike Davis", count: 9, rank: 3 }
      ],
      community_builders: [
        { user_id: "u4", name: "Emma Wilson", score: 156, rank: 1 },
        { user_id: "u5", name: "David Lee", score: 142, rank: 2 },
        { user_id: "u6", name: "Lisa Garcia", score: 138, rank: 3 }
      ],
      streak_masters: [
        { user_id: "u7", name: "Tom Brown", days: 45, rank: 1 },
        { user_id: "u8", name: "Anna Smith", days: 38, rank: 2 },
        { user_id: "u9", name: "Chris Taylor", days: 32, rank: 3 }
      ]
    },
    recommendations: [
      {
        user_id: "u10",
        name: "Jordan Martinez",
        mutuals: 3,
        scores: {
          mutual_strength: 0.85,
          mutual_quality: 0.92,
          recency: 0.78,
          location: 0.88,
          total: 0.86
        },
        explain: "You have 3 mutual connections and similar interests."
      },
      {
        user_id: "u11",
        name: "Casey Kim",
        mutuals: 2,
        scores: {
          mutual_strength: 0.72,
          mutual_quality: 0.89,
          recency: 0.85,
          location: 0.91,
          total: 0.82
        },
        explain: "You have 2 mutual connections and similar interests."
      }
    ]
  };
}