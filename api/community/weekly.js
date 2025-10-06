// GET /api/community/weekly?user_id=:id
// Weekly Pulse endpoint for Community page
// Date: 2025-01-15

// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';

const DATA_READER_URL = process.env.DATA_READER_URL;
const DATA_READER_SECRET = process.env.DATA_READER_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id } = req.query;
  
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    console.log('📊 Fetching community weekly data from Cloud Run backend...');
    
    // Call the Cloud Run backend service for community data
    const response = await fetch(`${DATA_READER_URL}/community/weekly?user_id=${encodeURIComponent(user_id)}`, {
      method: 'GET',
      headers: {
        'x-data-key': DATA_READER_SECRET,
        'Content-Type': 'application/json'
      },
      // Add timeout
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Backend doesn't have community endpoint yet, return mock data
        console.log('📊 Community endpoint not available, returning mock data');
        return res.status(200).json(getMockWeeklyData());
      }
      throw new Error(`Backend service failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Successfully fetched community data from backend service');

    // Set cache headers for Vercel
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.setHeader('Content-Type', 'application/json');
    
    return res.status(200).json(data);

  } catch (error) {
    console.error('❌ Error fetching community data from backend service:', error);
    
    // Fallback to mock data on any error
    console.log('📊 Backend error, returning mock data as fallback');
    return res.status(200).json(getMockWeeklyData());
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

// Mock data function for when backend service is not available
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