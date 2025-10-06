-- Migration: 002_backfill_gamification_data.sql
-- Description: Populate initial data from existing taps and users
-- Date: 2025-01-15

-- Backfill home locations from users table
INSERT INTO home_location_struct (user_id, city, state, country, original_text)
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
FROM users 
WHERE home IS NOT NULL AND home != ''
ON CONFLICT (user_id) DO NOTHING;

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

-- Backfill daily activity for the last 30 days
INSERT INTO user_day_activity (user_id, day, tap_count, first_degree_new_count)
SELECT 
    u.id as user_id,
    DATE(t.time) as day,
    COUNT(*) as tap_count,
    COUNT(CASE WHEN t.time >= u.created_at THEN 1 END) as first_degree_new_count
FROM users u
LEFT JOIN taps t ON (t.id1 = u.id OR t.id2 = u.id)
WHERE t.time >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY u.id, DATE(t.time)
ON CONFLICT (user_id, day) DO NOTHING;

-- Backfill weekly activity for the last 4 weeks
INSERT INTO user_week_activity (user_id, iso_week, year, tap_count, first_degree_new_count, second_degree_count)
SELECT 
    u.id as user_id,
    EXTRACT(week FROM t.time) as iso_week,
    EXTRACT(year FROM t.time) as year,
    COUNT(*) as tap_count,
    COUNT(CASE WHEN t.time >= u.created_at THEN 1 END) as first_degree_new_count,
    0 as second_degree_count -- Will be calculated by ETL job
FROM users u
LEFT JOIN taps t ON (t.id1 = u.id OR t.id2 = u.id)
WHERE t.time >= CURRENT_DATE - INTERVAL '4 weeks'
GROUP BY u.id, EXTRACT(week FROM t.time), EXTRACT(year FROM t.time)
ON CONFLICT (user_id, iso_week, year) DO NOTHING;

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
