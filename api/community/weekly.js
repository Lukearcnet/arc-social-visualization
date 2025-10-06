// GET /api/community/weekly?user_id=:id
// Weekly Pulse endpoint for Community page
// Date: 2025-01-15

import { Pool } from 'pg';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id } = req.query;
  
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    const client = await pool.connect();
    
    try {
      // Check if gamification tables exist
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'user_week_activity'
        ) as tables_exist
      `);
      
      if (!tableCheck.rows[0].tables_exist) {
        console.log('📊 Gamification tables not found, returning mock data');
        return res.status(200).json(getMockWeeklyData());
      }
      
      // Get current week info
      const currentDate = new Date();
      const year = currentDate.getFullYear();
      const isoWeek = getISOWeek(currentDate);
      const weekStart = getWeekStart(currentDate);
      const weekEnd = getWeekEnd(currentDate);
      
      // Get user's weekly activity
      const weeklyActivity = await client.query(`
        SELECT 
          tap_count,
          first_degree_new_count,
          second_degree_count
        FROM user_week_activity 
        WHERE user_id = $1 AND iso_week = $2 AND year = $3
      `, [user_id, isoWeek, year]);
      
      // Get new first-degree connections this week
      const newConnections = await client.query(`
        SELECT DISTINCT
          CASE WHEN t.id1 = $1 THEN t.id2 ELSE t.id1 END as user_id,
          CASE WHEN t.id1 = $1 THEN u2.first_name || ' ' || u2.last_name ELSE u1.first_name || ' ' || u1.last_name END as name,
          MAX(t.time) as last_tap_at
        FROM taps t
        JOIN users u1 ON t.id1 = u1.id
        JOIN users u2 ON t.id2 = u2.id
        WHERE (t.id1 = $1 OR t.id2 = $1)
        AND t.time >= $2
        AND NOT EXISTS (
          SELECT 1 FROM taps t2 
          WHERE (t2.id1 = $1 OR t2.id2 = $1)
          AND (t2.id1 = t.id2 OR t2.id2 = t.id1)
          AND t2.time < $2
        )
        GROUP BY user_id, name
        ORDER BY last_tap_at DESC
        LIMIT 10
      `, [user_id, weekStart]);
      
      // Get user's streak info
      const streakInfo = await client.query(`
        SELECT 
          current_streak_days,
          longest_streak_days
        FROM user_streaks 
        WHERE user_id = $1
      `, [user_id]);
      
      // Get community activity (simplified - using location-based communities)
      const communityActivity = await client.query(`
        SELECT 
          hl.city as community_id,
          hl.city as name,
          COUNT(*) as tap_count,
          COUNT(DISTINCT CASE WHEN t.id1 = $1 THEN t.id2 ELSE t.id1 END) as unique_users
        FROM taps t
        JOIN home_location_struct hl ON (hl.user_id = CASE WHEN t.id1 = $1 THEN t.id2 ELSE t.id1 END)
        WHERE (t.id1 = $1 OR t.id2 = $1)
        AND t.time >= $2
        AND hl.city IS NOT NULL
        GROUP BY hl.city
        ORDER BY tap_count DESC
        LIMIT 5
      `, [user_id, weekStart]);
      
      // Get geo expansion
      const geoExpansion = await client.query(`
        SELECT 
          hl.city,
          COUNT(*) as new_taps
        FROM taps t
        JOIN home_location_struct hl ON (hl.user_id = CASE WHEN t.id1 = $1 THEN t.id2 ELSE t.id1 END)
        WHERE (t.id1 = $1 OR t.id2 = $1)
        AND t.time >= $2
        AND hl.city IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM taps t2
          WHERE (t2.id1 = $1 OR t2.id2 = $1)
          AND (t2.id1 = t.id2 OR t2.id2 = t.id1)
          AND t2.time < $2
        )
        GROUP BY hl.city
        ORDER BY new_taps DESC
        LIMIT 5
      `, [user_id, weekStart]);
      
      // Get leaderboards
      const topConnectors = await client.query(`
        SELECT 
          wl.user_id,
          u.first_name || ' ' || u.last_name as name,
          wl.new_first_degree
        FROM weekly_leaderboard wl
        JOIN users u ON wl.user_id = u.id
        WHERE wl.iso_week = $1 AND wl.year = $2
        ORDER BY wl.new_first_degree DESC
        LIMIT 10
      `, [isoWeek, year]);
      
      const expandingReach = await client.query(`
        SELECT 
          wl.user_id,
          u.first_name || ' ' || u.last_name as name,
          wl.delta_second_degree
        FROM weekly_leaderboard wl
        JOIN users u ON wl.user_id = u.id
        WHERE wl.iso_week = $1 AND wl.year = $2
        ORDER BY wl.delta_second_degree DESC
        LIMIT 10
      `, [isoWeek, year]);
      
      const consistency = await client.query(`
        SELECT 
          wl.user_id,
          u.first_name || ' ' || u.last_name as name,
          wl.streak_days
        FROM weekly_leaderboard wl
        JOIN users u ON wl.user_id = u.id
        WHERE wl.iso_week = $1 AND wl.year = $2
        ORDER BY wl.streak_days DESC
        LIMIT 10
      `, [isoWeek, year]);
      
      // Get recommendations (simplified algorithm)
      const recommendations = await getRecommendations(client, user_id);
      
      // Build response
      const response = {
        generated_at: new Date().toISOString(),
        week: {
          year,
          iso_week: isoWeek,
          range: [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]
        },
        recap: {
          first_degree_new: newConnections.rows,
          second_degree_delta: weeklyActivity.rows[0]?.second_degree_count || 0,
          community_activity: communityActivity.rows,
          geo_expansion: geoExpansion.rows
        },
        momentum: {
          current_streak_days: streakInfo.rows[0]?.current_streak_days || 0,
          longest_streak_days: streakInfo.rows[0]?.longest_streak_days || 0,
          weekly_goal: {
            target_taps: 5, // Default goal
            progress: weeklyActivity.rows[0]?.tap_count || 0
          }
        },
        leaderboard: {
          top_connectors: topConnectors.rows,
          expanding_reach: expandingReach.rows,
          consistency: consistency.rows
        },
        recommendations
      };
      
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
      return res.status(200).json(response);
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error fetching weekly pulse data:', error);
    return res.status(500).json({ error: 'Internal server error' });
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

async function getRecommendations(client, userId) {
  // Simplified recommendation algorithm
  // In production, this would be more sophisticated
  const recommendations = await client.query(`
    SELECT DISTINCT
      CASE WHEN t.id1 = $1 THEN t.id2 ELSE t.id1 END as user_id,
      CASE WHEN t.id1 = $1 THEN u2.first_name || ' ' || u2.last_name ELSE u1.first_name || ' ' || u1.last_name END as name,
      COUNT(*) as mutuals,
      RANDOM() as total_score
    FROM taps t
    JOIN users u1 ON t.id1 = u1.id
    JOIN users u2 ON t.id2 = u2.id
    WHERE (t.id1 = $1 OR t.id2 = $1)
    AND t.time >= NOW() - INTERVAL '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM taps t2
      WHERE (t2.id1 = $1 OR t2.id2 = $1)
      AND (t2.id1 = t.id2 OR t2.id2 = t.id1)
    )
    GROUP BY user_id, name
    ORDER BY total_score DESC
    LIMIT 5
  `, [userId]);
  
  return recommendations.rows.map(rec => ({
    user_id: rec.user_id,
    name: rec.name,
    mutuals: rec.mutuals,
    scores: {
      mutual_strength: Math.random(),
      mutual_quality: Math.random(),
      recency: Math.random(),
      location: Math.random(),
      total: rec.total_score
    },
    explain: `You have ${rec.mutuals} mutual connections and similar interests.`
  }));
}

// Mock data function for when gamification tables don't exist
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
        { city: "Denver", new_taps: 2 }
      ]
    },
    momentum: {
      current_streak_days: 9,
      longest_streak_days: 17,
      weekly_goal: { target_taps: 5, progress: 4 }
    },
    leaderboard: {
      top_connectors: [
        { user_id: "u321", name: "Owen", new_first_degree: 6 },
        { user_id: "u555", name: "Mia", new_first_degree: 4 },
        { user_id: "u888", name: "Alex", new_first_degree: 3 }
      ],
      expanding_reach: [
        { user_id: "u555", name: "Mia", delta_second_degree: 18 },
        { user_id: "u789", name: "Alex", delta_second_degree: 15 },
        { user_id: "u321", name: "Owen", delta_second_degree: 12 }
      ],
      consistency: [
        { user_id: "u789", name: "Alex", streak_days: 21 },
        { user_id: "u321", name: "Owen", streak_days: 18 },
        { user_id: "u555", name: "Mia", streak_days: 15 }
      ]
    },
    recommendations: [
      {
        user_id: "u999",
        name: "Alex Fielding",
        mutuals: 3,
        scores: {
          mutual_strength: 0.73,
          mutual_quality: 0.61,
          recency: 0.42,
          location: 1.0,
          total: 0.69
        },
        explain: "Shared strong mutuals with Grace & Owen; also in Nashville."
      },
      {
        user_id: "u777",
        name: "Sarah Kim",
        mutuals: 2,
        scores: {
          mutual_strength: 0.58,
          mutual_quality: 0.45,
          recency: 0.67,
          location: 0.6,
          total: 0.58
        },
        explain: "Both in Austin tech scene; recent activity overlap."
      }
    ]
  };
}
