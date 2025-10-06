-- =====================================================
-- GAMIFICATION ROLLUP SQL - IMPROVED VERSION
-- Implements improvements A-D from GAMIFICATION.md
-- Date: 2025-01-15
-- =====================================================

-- A.1 Improve First-Degree New Count (Replace placeholder logic)
SET LOCAL statement_timeout = '45s';
UPDATE gamification.user_week_activity 
SET first_degree_new_count = (
  SELECT COUNT(DISTINCT LEAST(t.id1, t.id2), GREATEST(t.id1, t.id2))
  FROM public.taps t
  WHERE (t.id1 = user_week_activity.user_id OR t.id2 = user_week_activity.user_id)
  AND t."time" >= DATE_TRUNC('week', CURRENT_DATE - INTERVAL '1 week')
  AND t."time" < DATE_TRUNC('week', CURRENT_DATE)
  AND NOT EXISTS (
    SELECT 1 FROM public.taps t2 
    WHERE (t2.id1 = user_week_activity.user_id OR t2.id2 = user_week_activity.user_id)
    AND (t2.id1 = t.id2 OR t2.id2 = t.id1)
    AND t2."time" < DATE_TRUNC('week', CURRENT_DATE - INTERVAL '1 week')
  )
),
last_updated_at = NOW()
WHERE iso_week = EXTRACT(week FROM CURRENT_DATE - INTERVAL '1 week')
AND year = EXTRACT(year FROM CURRENT_DATE - INTERVAL '1 week');

-- A.2 Add Second-Degree Count (Lightweight approximation)
SET LOCAL statement_timeout = '45s';
UPDATE gamification.user_week_activity 
SET second_degree_count = (
  SELECT COUNT(DISTINCT CASE 
    WHEN t1.id1 = user_week_activity.user_id THEN t1.id2 
    ELSE t1.id1 
  END)
  FROM public.taps t1
  JOIN public.taps t2 ON (
    (t1.id1 = t2.id1 AND t1.id2 != t2.id2) OR 
    (t1.id1 = t2.id2 AND t1.id2 != t2.id1) OR
    (t1.id2 = t2.id1 AND t1.id1 != t2.id2) OR
    (t1.id2 = t2.id2 AND t1.id1 != t2.id1)
  )
  WHERE (t1.id1 = user_week_activity.user_id OR t1.id2 = user_week_activity.user_id)
  AND t1."time" >= DATE_TRUNC('week', CURRENT_DATE - INTERVAL '1 week')
  AND t1."time" < DATE_TRUNC('week', CURRENT_DATE)
  AND t2."time" >= DATE_TRUNC('week', CURRENT_DATE - INTERVAL '1 week')
  AND t2."time" < DATE_TRUNC('week', CURRENT_DATE)
  AND (t2.id1 != user_week_activity.user_id AND t2.id2 != user_week_activity.user_id)
),
last_updated_at = NOW()
WHERE iso_week = EXTRACT(week FROM CURRENT_DATE - INTERVAL '1 week')
AND year = EXTRACT(year FROM CURRENT_DATE - INTERVAL '1 week');

-- B.1 Improve Edge Strength (True 90-day rolling window)
SET LOCAL statement_timeout = '45s';
UPDATE gamification.edge_strength 
SET taps_90d = (
  SELECT COUNT(*)
  FROM public.taps t
  WHERE (t.id1 = edge_strength.u1 AND t.id2 = edge_strength.u2) 
     OR (t.id1 = edge_strength.u2 AND t.id2 = edge_strength.u1)
  AND t."time" >= NOW() - INTERVAL '90 days'
),
last_tap_at = (
  SELECT MAX(t."time")
  FROM public.taps t
  WHERE (t.id1 = edge_strength.u1 AND t.id2 = edge_strength.u2) 
     OR (t.id1 = edge_strength.u2 AND t.id2 = edge_strength.u1)
  AND t."time" >= NOW() - INTERVAL '90 days'
),
strength_f32 = LEAST(
  (SELECT COUNT(*) FROM public.taps t
   WHERE (t.id1 = edge_strength.u1 AND t.id2 = edge_strength.u2) 
      OR (t.id1 = edge_strength.u2 AND t.id2 = edge_strength.u1)
   AND t."time" >= NOW() - INTERVAL '90 days') / 10.0, 
  1.0
),
updated_at = NOW()
WHERE EXISTS (
  SELECT 1 FROM public.taps t
  WHERE (t.id1 = edge_strength.u1 AND t.id2 = edge_strength.u2) 
     OR (t.id1 = edge_strength.u2 AND t.id2 = edge_strength.u1)
  AND t."time" >= NOW() - INTERVAL '100 days'
);

-- C.1 Populate Weekly Leaderboard
SET LOCAL statement_timeout = '45s';
INSERT INTO gamification.weekly_leaderboard (
  user_id, iso_week, year, new_first_degree, delta_second_degree, streak_days
)
SELECT 
  uwa.user_id,
  uwa.iso_week,
  uwa.year,
  uwa.first_degree_new_count as new_first_degree,
  uwa.second_degree_count as delta_second_degree,
  COALESCE(us.current_streak_days, 0) as streak_days
FROM gamification.user_week_activity uwa
LEFT JOIN gamification.user_streaks us ON uwa.user_id = us.user_id
WHERE uwa.iso_week = EXTRACT(week FROM CURRENT_DATE - INTERVAL '1 week')
AND uwa.year = EXTRACT(year FROM CURRENT_DATE - INTERVAL '1 week')
ON CONFLICT (user_id, iso_week, year) 
DO UPDATE SET
  new_first_degree = EXCLUDED.new_first_degree,
  delta_second_degree = EXCLUDED.delta_second_degree,
  streak_days = EXCLUDED.streak_days;

-- D.1 Add Metrics Logging
SET LOCAL statement_timeout = '45s';
SELECT 
  'ROLLUP_METRICS' as log_type,
  COUNT(DISTINCT user_id) as users_touched,
  COUNT(DISTINCT day) as days_processed,
  COUNT(DISTINCT iso_week) as weeks_processed,
  COUNT(DISTINCT u1, u2) as edges_processed,
  NOW() as completed_at
FROM (
  SELECT user_id, day FROM gamification.user_day_activity WHERE updated_at >= NOW() - INTERVAL '1 hour'
  UNION
  SELECT user_id, NULL as day FROM gamification.user_week_activity WHERE last_updated_at >= NOW() - INTERVAL '1 hour'
  UNION  
  SELECT u1 as user_id, NULL as day FROM gamification.edge_strength WHERE updated_at >= NOW() - INTERVAL '1 hour'
  UNION
  SELECT u2 as user_id, NULL as day FROM gamification.edge_strength WHERE updated_at >= NOW() - INTERVAL '1 hour'
) combined;
