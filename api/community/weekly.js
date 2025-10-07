// GET /api/community/weekly?user_id=:id
// Weekly Pulse endpoint for Community page
// Date: 2025-01-15

// Use shared database pool
const { getPool } = require('../../lib/db');
const { proxyOr } = require('../../lib/http');
const { assembleWeeklyPayload } = require('../../lib/weekly/assembleWeeklyPayload');
const pool = getPool();

// Local function for direct DB access
const localHandler = async (req, res) => {
  console.log('🚀 COMMUNITY API HANDLER CALLED - NEW VERSION');
  const startTime = Date.now();
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, strict, debug, demo } = req.query;
  const isDebug = debug === '1';
  const isDemo = demo === '1';
  
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  // Demo mode - return example data
  if (isDemo) {
    console.log('🎭 [weekly] Demo mode enabled - returning example data');
    try {
      const fs = require('fs');
      const path = require('path');
      const examplePath = path.join(__dirname, '../../example_weekly.json');
      const exampleData = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
      
      // Override meta for demo
      exampleData.meta = {
        ...exampleData.meta,
        source: 'demo',
        duration_ms: Date.now() - startTime,
        user_id: user_id,
        watermark: new Date().toISOString()
      };
      
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json(exampleData);
    } catch (demoError) {
      console.error('❌ [weekly] Demo mode failed:', demoError);
      return res.status(500).json({ error: 'Demo mode failed' });
    }
  }

  try {
    console.log('📊 Assembling weekly payload from database...');
    
    // Use the assembler to build the payload
    const payload = await assembleWeeklyPayload(pool, user_id);
    
    // Override meta with current context
    payload.meta = {
      ...payload.meta,
      source: process.env.DATA_READER_URL ? 'reader' : 'db',
      duration_ms: Date.now() - startTime,
      user_id: user_id,
      watermark: new Date().toISOString(),
      warnings: payload.meta?.warnings || []
    };
    
    // Debug logging
    if (isDebug) {
      console.log('🔍 [weekly] Response data:', {
        recap: {
          first_degree_new: payload.recap.first_degree_new.length,
          second_degree_delta: payload.recap.second_degree_delta,
          community_activity: payload.recap.community_activity.length
        },
        momentum: {
          current_streak_days: payload.momentum.current_streak_days,
          weekly_goal: payload.momentum.weekly_goal
        },
        leaderboard: {
          new_connections: payload.leaderboard.new_connections.length,
          community_builders: payload.leaderboard.community_builders.length,
          streak_masters: payload.leaderboard.streak_masters.length
        },
        recommendations: payload.recommendations.length
      });
    }
    
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(payload);
    
  } catch (error) {
    console.error('❌ [weekly] Database query failed:', error);
    
    if (isDebug) {
      return res.status(500).json({
        ok: false,
        at: 'weekly:database',
        code: error.code || 'DATABASE_ERROR',
        message: error.message,
        detail: error.detail || null,
        hint: error.hint || null,
        dbUrlPresent: !!process.env.DATABASE_URL
      });
    } else {
      return res.status(500).json({ 
        error: 'database_error',
        message: 'Failed to fetch community data'
      });
    }
  }
};

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

handler.config = { runtime: 'nodejs' };
module.exports = handler;