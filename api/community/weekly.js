// GET /api/community/weekly?user_id=:id
// Weekly Pulse endpoint for Community page (Data Reader version)
// Date: 2025-01-15

const { assembleWeeklyFromExport } = require('../../lib/weekly/assembleFromExport');

// Main handler
const handler = async (req, res) => {
  const startTime = Date.now();
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, debug, demo, time_window } = req.query;
  const isDebug = debug === '1';
  const isDemo = demo === '1';
  const timeWindow = time_window || '1week';
  
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
      
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json(exampleData);
    } catch (demoError) {
      console.error('❌ [weekly] Demo mode failed:', demoError);
      return res.status(500).json({ error: 'Demo mode failed' });
    }
  }

  try {
    console.log('📊 Fetching data from Data Reader...');
    
    // Fetch data from Data Reader
    const DATA_READER_URL = process.env.DATA_READER_URL;
    const DATA_READER_SECRET = process.env.DATA_READER_SECRET;
    
    if (!DATA_READER_URL || !DATA_READER_SECRET) {
      throw new Error('DATA_READER_URL and DATA_READER_SECRET must be configured');
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const response = await fetch(`${DATA_READER_URL}/data-export`, {
      method: 'GET',
      headers: {
        'x-data-key': DATA_READER_SECRET,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Data Reader returned ${response.status}: ${response.statusText}`);
    }
    
    const exportData = await response.json();
    
    if (isDebug) {
      console.log('🔍 [weekly] Data Reader export keys:', Object.keys(exportData));
      console.log('🔍 [weekly] Sample tap:', exportData.taps?.[0]);
      console.log('🔍 [weekly] Sample user:', exportData.users?.[0]);
      console.log('🔍 [weekly] Total taps:', exportData.taps?.length || 0);
      console.log('🔍 [weekly] Total users:', exportData.users?.length || 0);
    }
    
    // Assemble weekly payload from export data
    const payload = assembleWeeklyFromExport({
      userId: user_id,
      taps: exportData.taps || [],
      users: exportData.users || [],
      nowUtc: new Date().toISOString(),
      timeWindow: timeWindow,
      isDebug: isDebug
    });
    
    // Check if assembler returned an error payload
    if (payload.meta?.warnings?.some(w => w.includes('Assembler error'))) {
      console.error('❌ [weekly] Assembler error detected:', payload.meta.debug);
      if (isDebug) {
        return res.status(500).json({
          error: 'assembler_error',
          message: payload.meta.warnings[0],
          debug: payload.meta.debug
        });
      }
    }
    
    // Ensure required fields are present
    const nowUtc = new Date().toISOString();
    
    function isoWeekRange(d = new Date()) {
      const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const day = utc.getUTCDay() || 7;                // Mon=1..Sun=7
      const monday = new Date(utc); monday.setUTCDate(utc.getUTCDate() - (day - 1));
      const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
      const pad = x => String(x).padStart(2,'0');
      const toYMD = x => `${x.getUTCFullYear()}-${pad(x.getUTCMonth()+1)}-${pad(x.getUTCDate())}`;
      const firstThu = new Date(Date.UTC(utc.getUTCFullYear(),0,4));
      const week = Math.floor(( (utc - new Date(Date.UTC(utc.getUTCFullYear(),0,1)))/86400000 + firstThu.getUTCDay()+1 )/7);
      return { year: utc.getUTCFullYear(), iso_week: week, range: [toYMD(monday), toYMD(sunday)] };
    }
    
    // Build final output with required fields
    const out = {
      source: 'reader',
      generated_at: nowUtc,
      week: isoWeekRange(new Date(nowUtc)),
      ...payload,            // must contain recap, momentum, leaderboard, recommendations, meta
    };
    
    // Defensive: if assembler already set source/week, keep them
    out.source = out.source ?? 'reader';
    out.week   = out.week   ?? isoWeekRange(new Date(nowUtc));
    
    // Add duration to meta
    out.meta = {
      ...out.meta,
      duration_ms: Date.now() - startTime,
      user_id: user_id,
      watermark: new Date().toISOString(),
      warnings: out.meta?.warnings || []
    };
    
    // Final shape check
    if (!out.source || !out.week) {
      console.error('WEEKLY_SHAPE_ERROR', { keys: Object.keys(out) });
      if (isDebug) out.meta = { ...(out.meta||{}), warnings:[...(out.meta?.warnings||[]),'fixed missing source/week'] };
    }
    
    // Debug logging
    if (isDebug) {
      console.log('🔍 [weekly] Assembled payload counts:', {
        recap: {
          first_degree_new: out.recap.first_degree_new.length,
          second_degree_delta: out.recap.second_degree_delta,
          community_activity: out.recap.community_activity.length
        },
        momentum: {
          current_streak_days: out.momentum.current_streak_days,
          weekly_taps: out.momentum.weekly_taps,
          new_connections: out.momentum.new_connections
        },
        leaderboard: {
          new_connections: out.leaderboard.new_connections.length,
          community_builders: out.leaderboard.community_builders.length,
          streak_masters: out.leaderboard.streak_masters.length
        },
        recommendations: out.recommendations.length
      });
      
      // Add names resolved debug info
      out.meta.debug = {
        ...out.meta.debug,
        names_resolved: exportData.users?.length || 0
      };
    }
    
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(out);
    
  } catch (error) {
    console.error('❌ [weekly] Data Reader fetch failed:', error);
    
    if (isDebug) {
      return res.status(500).json({
        ok: false,
        at: 'weekly:reader',
        code: error.code || 'READER_ERROR',
        message: error.message,
        detail: error.detail || null,
        hint: 'Check DATA_READER_URL and DATA_READER_SECRET configuration'
      });
    } else {
      return res.status(500).json({ 
        error: 'reader_error',
        message: 'Failed to fetch community data from Data Reader'
      });
    }
  }
};

handler.config = { runtime: 'nodejs' };
module.exports = handler;