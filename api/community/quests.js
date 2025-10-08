// GET /api/community/quests?user_id=:id
// Quests endpoint for Community page
// Date: 2025-01-15

const { getExport } = require('../../lib/community/exportReader');

// Helper function to get ISO week
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

// Helper function to get start of ISO week
function startOfIsoWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// Helper function to get end of ISO week
function endOfIsoWeek(date) {
  const start = startOfIsoWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
}

// Main handler
const handler = async (req, res) => {
  const startTime = Date.now();
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, debug } = req.query;
  const isDebug = debug === '1';
  
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    console.log('🎯 [quests] Computing weekly quests...');
    
    // Fetch data from Data Reader
    const { taps, users } = await getExport({ req, res, debug: isDebug });
    
    // Get current ISO week bounds
    const now = new Date();
    const currentWeek = getISOWeek(now);
    const currentYear = now.getFullYear();
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
      return id1 === user_id || id2 === user_id;
    });
    
    // Calculate weekly metrics
    const weeklyTaps = userTaps.length;
    
    // Count unique new first-degree connections this week
    const newFirstDegree = new Set();
    userTaps.forEach(tap => {
      const id1 = tap.user1_id || tap.id1;
      const id2 = tap.user2_id || tap.id2;
      const otherId = id1 === user_id ? id2 : id1;
      if (otherId && otherId !== user_id) {
        newFirstDegree.add(otherId);
      }
    });
    
    // Calculate streak days (naive implementation)
    const userDailyTaps = {};
    userTaps.forEach(tap => {
      const day = new Date(tap.time).toISOString().split('T')[0];
      userDailyTaps[day] = (userDailyTaps[day] || 0) + 1;
    });
    
    // Calculate consecutive days with activity up to today
    let streakDays = 0;
    const today = new Date().toISOString().split('T')[0];
    const sortedDays = Object.keys(userDailyTaps).sort().reverse();
    
    for (const day of sortedDays) {
      if (day <= today && userDailyTaps[day] > 0) {
        streakDays++;
      } else {
        break;
      }
    }
    
    // Define quests with progress
    const quests = [
      {
        id: 'connect_5',
        title: 'Network Builder',
        progress: Math.min(newFirstDegree.size, 5),
        target: 5,
        unit: 'people'
      },
      {
        id: 'taps_25',
        title: 'Consistency',
        progress: Math.min(weeklyTaps, 25),
        target: 25,
        unit: 'taps'
      },
      {
        id: 'streak_3',
        title: 'Keep it going',
        progress: Math.min(streakDays, 3),
        target: 3,
        unit: 'days'
      }
    ];
    
    const response = {
      source: 'reader',
      user_id: user_id,
      week: {
        year: currentYear,
        iso_week: currentWeek
      },
      quests: quests,
      meta: {
        duration_ms: Date.now() - startTime
      }
    };
    
    if (isDebug) {
      response.meta.debug = {
        weekly_taps: weeklyTaps,
        new_first_degree: newFirstDegree.size,
        streak_days: streakDays,
        week_start: weekStart.toISOString(),
        week_end: weekEnd.toISOString()
      };
    }
    
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('❌ [quests] Quest calculation failed:', error);
    
    if (isDebug) {
      return res.status(500).json({
        ok: false,
        at: 'quests:calculation',
        code: error.code || 'QUESTS_ERROR',
        message: error.message,
        detail: error.detail || null
      });
    } else {
      return res.status(500).json({ 
        error: 'quest_calculation_failed',
        message: 'Failed to calculate quest progress'
      });
    }
  }
};

handler.config = { runtime: 'nodejs' };
module.exports = handler;
