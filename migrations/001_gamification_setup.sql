-- =====================================================
-- GAMIFICATION DATABASE SETUP - CORRECTED VERSION
-- Target Schema: gamification.*
-- Source Schema: public.* (READ-ONLY)
-- Date: 2025-01-15
-- =====================================================

-- STEP 1: CREATE EXTENSION
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- STEP 2: CREATE GAMIFICATION SCHEMA
CREATE SCHEMA IF NOT EXISTS gamification;

-- STEP 3: CREATE TABLES (DDL)
-- =====================================================

-- 3.1 User Activity Rollups
CREATE TABLE gamification.user_day_activity (
    user_id UUID NOT NULL,
    day DATE NOT NULL,
    tap_count INTEGER DEFAULT 0,
    first_degree_new_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, day)
);

CREATE TABLE gamification.user_week_activity (
    user_id UUID NOT NULL,
    iso_week INTEGER NOT NULL,
    year INTEGER NOT NULL,
    tap_count INTEGER DEFAULT 0,
    first_degree_new_count INTEGER DEFAULT 0,
    second_degree_count INTEGER DEFAULT 0,
    last_updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, iso_week, year)
);

-- 3.2 Streak Tracking
CREATE TABLE gamification.user_streaks (
    user_id UUID PRIMARY KEY,
    current_streak_days INTEGER DEFAULT 0,
    longest_streak_days INTEGER DEFAULT 0,
    last_tap_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 3.3 Connection Strength
CREATE TABLE gamification.edge_strength (
    u1 UUID NOT NULL,
    u2 UUID NOT NULL,
    taps_90d INTEGER DEFAULT 0,
    last_tap_at TIMESTAMP,
    strength_f32 FLOAT DEFAULT 0.0,
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (u1, u2)
);

-- 3.4 Parsed Home Locations
CREATE TABLE gamification.home_location_struct (
    user_id UUID PRIMARY KEY,
    city VARCHAR(100),
    state VARCHAR(50),
    country VARCHAR(50) DEFAULT 'US',
    original_text TEXT,
    geohash5 VARCHAR(10),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3.5 Weekly Leaderboards
CREATE TABLE gamification.weekly_leaderboard (
    user_id UUID NOT NULL,
    iso_week INTEGER NOT NULL,
    year INTEGER NOT NULL,
    new_first_degree INTEGER DEFAULT 0,
    delta_second_degree INTEGER DEFAULT 0,
    streak_days INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, iso_week, year)
);

-- 3.6 Quest System
CREATE TABLE gamification.quest_definitions (
    quest_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    quest_type VARCHAR(50) NOT NULL, -- 'reconnect', 'explore', 'community'
    requirements JSONB NOT NULL,
    rewards JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE gamification.user_quest_progress (
    user_id UUID NOT NULL,
    quest_id UUID NOT NULL,
    week_start DATE NOT NULL,
    progress JSONB DEFAULT '{}',
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, quest_id, week_start)
);

-- 3.7 Surge Detection
CREATE TABLE gamification.surge_windows (
    window_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    area_name VARCHAR(100) NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    surge_multiplier FLOAT NOT NULL,
    tap_count INTEGER NOT NULL,
    unique_users INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- STEP 4: CREATE INDEXES (GAMIFICATION SCHEMA ONLY)
-- =====================================================

CREATE INDEX idx_gamification_edge_strength_pairs ON gamification.edge_strength(u1, u2);
CREATE INDEX idx_gamification_edge_strength_reverse ON gamification.edge_strength(u2, u1);
CREATE INDEX idx_gamification_user_day_activity_lookup ON gamification.user_day_activity(user_id, day);
CREATE INDEX idx_gamification_user_week_activity_lookup ON gamification.user_week_activity(user_id, iso_week, year);
CREATE INDEX idx_gamification_home_location_geo ON gamification.home_location_struct(city, state, country);
CREATE INDEX idx_gamification_home_location_geohash ON gamification.home_location_struct(geohash5);
CREATE INDEX idx_gamification_surge_windows_time ON gamification.surge_windows(start_time, end_time);

-- STEP 5: CREATE HELPER FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION gamification.calculate_current_streak(user_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
    streak_days INTEGER := 0;
    current_date DATE := CURRENT_DATE;
    has_activity_today BOOLEAN := FALSE;
BEGIN
    -- Check if user has activity today
    SELECT EXISTS(
        SELECT 1 FROM public.taps 
        WHERE (id1 = user_uuid OR id2 = user_uuid) 
        AND DATE("time") = current_date
    ) INTO has_activity_today;
    
    -- If no activity today, start counting backwards
    IF NOT has_activity_today THEN
        current_date := current_date - INTERVAL '1 day';
    END IF;
    
    -- Count consecutive days with activity
    WHILE EXISTS(
        SELECT 1 FROM public.taps 
        WHERE (id1 = user_uuid OR id2 = user_uuid) 
        AND DATE("time") = current_date
    ) LOOP
        streak_days := streak_days + 1;
        current_date := current_date - INTERVAL '1 day';
    END LOOP;
    
    RETURN streak_days;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION gamification.calculate_longest_streak(user_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
    max_streak INTEGER := 0;
    current_streak INTEGER := 0;
    prev_date DATE;
    activity_date DATE;
BEGIN
    -- Get all activity dates for user, ordered by date
    FOR activity_date IN 
        SELECT DISTINCT DATE("time") 
        FROM public.taps 
        WHERE (id1 = user_uuid OR id2 = user_uuid)
        ORDER BY DATE("time")
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

-- STEP 6: BACKFILL DATA WITH TIMEOUTS
-- =====================================================

-- 6.1 Backfill Home Locations (30 second timeout)
SET statement_timeout = '30s';
INSERT INTO gamification.home_location_struct (user_id, city, state, country, original_text)
SELECT 
    id as user_id,
    CASE 
        WHEN home ~ '^[A-Za-z\s]+,\s*[A-Z]{2}$' THEN 
            TRIM(SPLIT_PART(home, ',', 1))
        WHEN home ~ '^[A-Za-z\s]+,\s*[A-Za-z\s]+$' THEN 
            TRIM(SPLIT_PART(home, ',', 1))
        ELSE TRIM(home)
    END as city,
    CASE 
        WHEN home ~ '^[A-Za-z\s]+,\s*[A-Z]{2}$' THEN 
            TRIM(SPLIT_PART(home, ',', 2))
        WHEN home ~ '^[A-Za-z\s]+,\s*[A-Za-z\s]+$' THEN 
            TRIM(SPLIT_PART(home, ',', 2))
        ELSE NULL
    END as state,
    'US' as country,
    home as original_text
FROM public.users 
WHERE home IS NOT NULL AND home != ''
ON CONFLICT (user_id) DO NOTHING;

-- 6.2 Backfill User Streaks (60 second timeout)
SET statement_timeout = '60s';
INSERT INTO gamification.user_streaks (user_id, current_streak_days, longest_streak_days, last_tap_at)
SELECT 
    id as user_id,
    COALESCE(gamification.calculate_current_streak(id), 0) as current_streak_days,
    COALESCE(gamification.calculate_longest_streak(id), 0) as longest_streak_days,
    MAX("time") as last_tap_at
FROM public.users u
LEFT JOIN public.taps t ON (t.id1 = u.id OR t.id2 = u.id)
GROUP BY u.id
ON CONFLICT (user_id) DO NOTHING;

-- 6.3 Backfill Daily Activity (45 second timeout)
SET statement_timeout = '45s';
INSERT INTO gamification.user_day_activity (user_id, day, tap_count, first_degree_new_count)
SELECT 
    u.id as user_id,
    DATE(t."time") as day,
    COUNT(*) as tap_count,
    COUNT(CASE WHEN t."time" >= u.created_at THEN 1 END) as first_degree_new_count
FROM public.users u
LEFT JOIN public.taps t ON (t.id1 = u.id OR t.id2 = u.id)
WHERE t."time" >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY u.id, DATE(t."time")
ON CONFLICT (user_id, day) DO NOTHING;

-- 6.4 Backfill Weekly Activity (45 second timeout)
SET statement_timeout = '45s';
INSERT INTO gamification.user_week_activity (user_id, iso_week, year, tap_count, first_degree_new_count, second_degree_count)
SELECT 
    u.id as user_id,
    EXTRACT(week FROM t."time") as iso_week,
    EXTRACT(year FROM t."time") as year,
    COUNT(*) as tap_count,
    COUNT(CASE WHEN t."time" >= u.created_at THEN 1 END) as first_degree_new_count,
    0 as second_degree_count  -- Will be calculated by ETL job
FROM public.users u
LEFT JOIN public.taps t ON (t.id1 = u.id OR t.id2 = u.id)
WHERE t."time" >= CURRENT_DATE - INTERVAL '28 days'
GROUP BY u.id, EXTRACT(week FROM t."time"), EXTRACT(year FROM t."time")
ON CONFLICT (user_id, iso_week, year) DO NOTHING;

-- 6.5 Backfill Edge Strength (60 second timeout)
SET statement_timeout = '60s';
INSERT INTO gamification.edge_strength (u1, u2, taps_90d, last_tap_at, strength_f32)
SELECT 
    LEAST(t.id1, t.id2) as u1,
    GREATEST(t.id1, t.id2) as u2,
    COUNT(*) as taps_90d,
    MAX(t."time") as last_tap_at,
    LEAST(COUNT(*) / 10.0, 1.0) as strength_f32  -- Normalized strength
FROM public.taps t
WHERE t."time" >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY LEAST(t.id1, t.id2), GREATEST(t.id1, t.id2)
ON CONFLICT (u1, u2) DO NOTHING;

-- STEP 7: INSERT INITIAL QUEST DEFINITIONS
-- =====================================================

INSERT INTO gamification.quest_definitions (title, description, quest_type, requirements, rewards, is_active)
VALUES 
    ('Daily Connector', 'Make 3 new connections today', 'community', 
     '{"daily_taps": 3}', '{"points": 100, "badge": "daily_connector"}', true),
    
    ('Weekend Explorer', 'Connect with 5 new people this weekend', 'explore',
     '{"weekend_taps": 5}', '{"points": 250, "badge": "weekend_explorer"}', true),
    
    ('Reconnection Master', 'Reconnect with 3 people you haven''t seen in 30+ days', 'reconnect',
     '{"reconnection_taps": 3}', '{"points": 500, "badge": "reconnection_master"}', true),
    
    ('Community Builder', 'Help 10 people make new connections', 'community',
     '{"assisted_connections": 10}', '{"points": 1000, "badge": "community_builder"}', true)
ON CONFLICT DO NOTHING;

-- STEP 8: RESET TIMEOUT
SET statement_timeout = '0';
