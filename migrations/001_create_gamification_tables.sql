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

-- Add foreign key constraints (assuming users table exists with id column)
-- Note: These will be added in a separate migration if needed
-- ALTER TABLE user_day_activity ADD CONSTRAINT fk_user_day_activity_user 
--     FOREIGN KEY (user_id) REFERENCES users(id);
-- ALTER TABLE user_week_activity ADD CONSTRAINT fk_user_week_activity_user 
--     FOREIGN KEY (user_id) REFERENCES users(id);
-- ALTER TABLE user_streaks ADD CONSTRAINT fk_user_streaks_user 
--     FOREIGN KEY (user_id) REFERENCES users(id);
-- ALTER TABLE edge_strength ADD CONSTRAINT fk_edge_strength_u1 
--     FOREIGN KEY (u1) REFERENCES users(id);
-- ALTER TABLE edge_strength ADD CONSTRAINT fk_edge_strength_u2 
--     FOREIGN KEY (u2) REFERENCES users(id);
-- ALTER TABLE home_location_struct ADD CONSTRAINT fk_home_location_user 
--     FOREIGN KEY (user_id) REFERENCES users(id);
-- ALTER TABLE weekly_leaderboard ADD CONSTRAINT fk_weekly_leaderboard_user 
--     FOREIGN KEY (user_id) REFERENCES users(id);
-- ALTER TABLE user_quest_progress ADD CONSTRAINT fk_user_quest_progress_user 
--     FOREIGN KEY (user_id) REFERENCES users(id);
-- ALTER TABLE user_quest_progress ADD CONSTRAINT fk_user_quest_progress_quest 
--     FOREIGN KEY (quest_id) REFERENCES quest_definitions(quest_id);
