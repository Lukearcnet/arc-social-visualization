// Cloud Run Job for Gamification Database Setup
// One-time setup job to create gamification tables and populate initial data
// Date: 2025-01-15

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get environment variables from Secret Manager (injected by Cloud Run)
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_NAME = process.env.DB_NAME;
const INSTANCE_CONNECTION_NAME = process.env.INSTANCE_CONNECTION_NAME;

// Create connection pool for Cloud SQL connector
const pool = new Pool({
  host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`, // Cloud SQL connector uses Unix socket
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  max: 1, // Keep pool small for Cloud Run Job
  // No SSL params needed with Cloud SQL connector
});

async function setupGamificationDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🎮 Setting up gamification database...');
    
    // 1. Create tables
    console.log('📊 Creating gamification tables...');
    const createTablesSQL = `
-- Migration: 001_create_gamification_tables.sql
-- Description: Create all gamification tables and indexes
-- Date: 2025-01-15

-- User activity rollups
CREATE TABLE IF NOT EXISTS user_day_activity (
    user_id UUID NOT NULL,
    day DATE NOT NULL,
    tap_count INTEGER DEFAULT 0,
    first_degree_new_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS user_week_activity (
    user_id UUID NOT NULL,
    iso_week INTEGER NOT NULL,
    year INTEGER NOT NULL,
    tap_count INTEGER DEFAULT 0,
    first_degree_new_count INTEGER DEFAULT 0,
    second_degree_count INTEGER DEFAULT 0,
    last_updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, iso_week, year)
);

-- Streak tracking
CREATE TABLE IF NOT EXISTS user_streaks (
    user_id UUID PRIMARY KEY,
    current_streak_days INTEGER DEFAULT 0,
    longest_streak_days INTEGER DEFAULT 0,
    last_tap_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Connection strength calculations
CREATE TABLE IF NOT EXISTS edge_strength (
    u1 UUID NOT NULL,
    u2 UUID NOT NULL,
    taps_90d INTEGER DEFAULT 0,
    last_tap_at TIMESTAMP,
    strength_f32 FLOAT DEFAULT 0.0,
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (u1, u2)
);

-- Parsed home locations
CREATE TABLE IF NOT EXISTS home_location_struct (
    user_id UUID PRIMARY KEY,
    city VARCHAR(100),
    state VARCHAR(50),
    country VARCHAR(50) DEFAULT 'US',
    original_text TEXT,
    geohash5 VARCHAR(10),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Weekly leaderboards
CREATE TABLE IF NOT EXISTS weekly_leaderboard (
    user_id UUID NOT NULL,
    iso_week INTEGER NOT NULL,
    year INTEGER NOT NULL,
    new_first_degree INTEGER DEFAULT 0,
    delta_second_degree INTEGER DEFAULT 0,
    streak_days INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, iso_week, year)
);

-- Quest system
CREATE TABLE IF NOT EXISTS quest_definitions (
    quest_id UUID PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    quest_type VARCHAR(50) NOT NULL, -- 'reconnect', 'explore', 'community'
    requirements JSONB NOT NULL,
    rewards JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_quest_progress (
    user_id UUID NOT NULL,
    quest_id UUID NOT NULL,
    week_start DATE NOT NULL,
    progress JSONB DEFAULT '{}',
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, quest_id, week_start)
);

-- Surge detection
CREATE TABLE IF NOT EXISTS surge_windows (
    window_id UUID PRIMARY KEY,
    area_name VARCHAR(100) NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    surge_multiplier FLOAT NOT NULL,
    tap_count INTEGER NOT NULL,
    unique_users INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_taps_user_created ON taps(id1, time);
CREATE INDEX IF NOT EXISTS idx_taps_other_created ON taps(id2, time);
CREATE INDEX IF NOT EXISTS idx_edge_strength_pairs ON edge_strength(u1, u2);
CREATE INDEX IF NOT EXISTS idx_edge_strength_reverse ON edge_strength(u2, u1);
CREATE INDEX IF NOT EXISTS idx_user_day_activity_lookup ON user_day_activity(user_id, day);
CREATE INDEX IF NOT EXISTS idx_user_week_activity_lookup ON user_week_activity(user_id, iso_week, year);
CREATE INDEX IF NOT EXISTS idx_home_location_geo ON home_location_struct(city, state, country);
CREATE INDEX IF NOT EXISTS idx_home_location_geohash ON home_location_struct(geohash5);
CREATE INDEX IF NOT EXISTS idx_surge_windows_time ON surge_windows(start_time, end_time);
    `;
    
    await client.query(createTablesSQL);
    console.log('✅ Tables created successfully');
    
    // 2. Backfill data
    console.log('📈 Backfilling initial data...');
    const backfillSQL = `
-- Backfill home locations from users table
INSERT INTO home_location_struct (user_id, city, state, country, original_text)
SELECT 
    id as user_id,
    CASE 
        WHEN home ~ '^[A-Za-z\\s]+,\\s*[A-Z]{2}$' THEN 
            TRIM(SPLIT_PART(home, ',', 1))
        WHEN home ~ '^[A-Za-z\\s]+,\\s*[A-Za-z\\s]+$' THEN 
            TRIM(SPLIT_PART(home, ',', 1))
        ELSE TRIM(home)
    END as city,
    CASE 
        WHEN home ~ '^[A-Za-z\\s]+,\\s*[A-Z]{2}$' THEN 
            TRIM(SPLIT_PART(home, ',', 2))
        WHEN home ~ '^[A-Za-z\\s]+,\\s*[A-Za-z\\s]+$' THEN 
            TRIM(SPLIT_PART(home, ',', 2))
        ELSE NULL
    END as state,
    'US' as country,
    home as original_text
FROM users 
WHERE home IS NOT NULL AND home != ''
ON CONFLICT (user_id) DO NOTHING;

-- Create helper functions for streak calculations
CREATE OR REPLACE FUNCTION calculate_current_streak(user_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
    streak_days INTEGER := 0;
    current_date DATE := CURRENT_DATE;
    has_activity_today BOOLEAN := FALSE;
BEGIN
    -- Check if user has activity today
    SELECT EXISTS(
        SELECT 1 FROM taps 
        WHERE (id1 = user_uuid OR id2 = user_uuid) 
        AND DATE(time) = current_date
    ) INTO has_activity_today;
    
    -- If no activity today, start counting backwards
    IF NOT has_activity_today THEN
        current_date := current_date - INTERVAL '1 day';
    END IF;
    
    -- Count consecutive days with activity
    WHILE EXISTS(
        SELECT 1 FROM taps 
        WHERE (id1 = user_uuid OR id2 = user_uuid) 
        AND DATE(time) = current_date
    ) LOOP
        streak_days := streak_days + 1;
        current_date := current_date - INTERVAL '1 day';
    END LOOP;
    
    RETURN streak_days;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION calculate_longest_streak(user_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
    max_streak INTEGER := 0;
    current_streak INTEGER := 0;
    prev_date DATE;
    activity_date DATE;
BEGIN
    -- Get all activity dates for user, ordered by date
    FOR activity_date IN 
        SELECT DISTINCT DATE(time) 
        FROM taps 
        WHERE (id1 = user_uuid OR id2 = user_uuid)
        ORDER BY DATE(time)
    LOOP
        IF prev_date IS NULL OR activity_date = prev_date + INTERVAL '1 day' THEN
            current_streak := current_streak + 1;
        ELSE
            current_streak := 1;
        END IF;
        
        IF current_streak > max_streak THEN
            max_streak := current_streak;
        END IF;
        
        prev_date := activity_date;
    END LOOP;
    
    RETURN max_streak;
END;
$$ LANGUAGE plpgsql;

-- Backfill user streaks (simplified calculation)
INSERT INTO user_streaks (user_id, current_streak_days, longest_streak_days, last_tap_at)
SELECT 
    id as user_id,
    COALESCE(calculate_current_streak(id), 0) as current_streak_days,
    COALESCE(calculate_longest_streak(id), 0) as longest_streak_days,
    MAX(time) as last_tap_at
FROM users u
LEFT JOIN taps t ON (t.id1 = u.id OR t.id2 = u.id)
GROUP BY u.id
ON CONFLICT (user_id) DO NOTHING;
    `;
    
    await client.query(backfillSQL);
    console.log('✅ Data backfilled successfully');
    
    // 3. Verify setup
    console.log('🔍 Verifying setup...');
    const tableCount = await client.query(`
      SELECT COUNT(*) as table_count
      FROM information_schema.tables 
      WHERE table_name IN (
        'user_day_activity', 'user_week_activity', 'user_streaks', 
        'edge_strength', 'home_location_struct', 'weekly_leaderboard',
        'quest_definitions', 'user_quest_progress', 'surge_windows'
      )
    `);
    
    const userCount = await client.query('SELECT COUNT(*) as user_count FROM users');
    const tapCount = await client.query('SELECT COUNT(*) as tap_count FROM taps');
    
    console.log(`✅ Setup complete!`);
    console.log(`📊 Tables created: ${tableCount.rows[0].table_count}`);
    console.log(`👥 Users in database: ${userCount.rows[0].user_count}`);
    console.log(`🔗 Taps in database: ${tapCount.rows[0].tap_count}`);
    
  } catch (error) {
    console.error('❌ Error setting up gamification database:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the setup if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupGamificationDatabase()
    .then(() => {
      console.log('🎉 Gamification database setup completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Gamification database setup failed:', error);
      process.exit(1);
    });
}

export { setupGamificationDatabase };
