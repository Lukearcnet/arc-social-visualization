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

  const { user_id, debug, demo } = req.query;
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
      nowUtc: new Date().toISOString()
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
    
    // Override meta with current context
    payload.meta = {
      ...payload.meta,
      source: 'reader',
      duration_ms: Date.now() - startTime,
      user_id: user_id,
      watermark: new Date().toISOString(),
      warnings: payload.meta?.warnings || []
    };
    
    // Debug logging
    if (isDebug) {
      console.log('🔍 [weekly] Assembled payload counts:', {
        recap: {
          first_degree_new: payload.recap.first_degree_new.length,
          second_degree_delta: payload.recap.second_degree_delta,
          community_activity: payload.recap.community_activity.length
        },
        momentum: {
          current_streak_days: payload.momentum.current_streak_days,
          weekly_taps: payload.momentum.weekly_taps,
          new_connections: payload.momentum.new_connections
        },
        leaderboard: {
          new_connections: payload.leaderboard.new_connections.length,
          community_builders: payload.leaderboard.community_builders.length,
          streak_masters: payload.leaderboard.streak_masters.length
        },
        recommendations: payload.recommendations.length
      });
      
      // Add names resolved debug info
      payload.meta.debug = {
        ...payload.meta.debug,
        names_resolved: exportData.users?.length || 0
      };
    }
    
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(payload);
    
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