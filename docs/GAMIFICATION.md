# 🎯 GAMIFICATION SYSTEM - CURRENT STATE & ROADMAP

## ✅ **CURRENT STATE - COMPLETED**

### **Database Schema (DEPLOYED)**
- ✅ **Schema**: `gamification` with 9 tables created
- ✅ **Tables**: `user_day_activity`, `user_week_activity`, `user_streaks`, `edge_strength`, `home_location_struct`, `weekly_leaderboard`, `quest_definitions`, `user_quest_progress`, `surge_windows`
- ✅ **Owner**: All tables owned by `arc_job`
- ✅ **Indexes**: Performance-optimized indexes created

### **Cloud Run Jobs (DEPLOYED)**
- ✅ **Setup Job**: `arc-gamification-setup` (us-central1)
- ✅ **ETL Job**: `arc-gamification-rollup` (us-central1)
- ✅ **Images**: `gcr.io/arcsocial/arc-gamification-setup:latest`, `gcr.io/arcsocial/arc-gamification-rollup:latest`
- ✅ **Secrets**: Using existing Secret Manager (DB_USER, DB_PASS, DB_NAME, INSTANCE_CONNECTION_NAME)
- ✅ **Connection**: Cloud SQL connector via `/cloudsql/${INSTANCE_CONNECTION_NAME}`

### **Data Processing (VERIFIED)**
- ✅ **user_day_activity**: 1,037 rows
- ✅ **user_week_activity**: 654 rows  
- ✅ **edge_strength**: 667 rows
- ✅ **Watermark**: `_watermark.last_run_at = 2025-10-06 19:08:35+00`

### **Live API Endpoints (DEPLOYED)**
- ✅ **Weekly Pulse**: `/api/community/weekly?user_id=...` - Returns weekly metrics, leaderboards, recommendations
- ✅ **Quests & Routes**: `/api/community/quests?user_id=...` - Returns quest progress with targets and units
- ✅ **Opportunity Radar**: `/api/community/radar?user_id=...&hours=24` - Returns hourly activity buckets and top participants
- ✅ **Relationship Health**: `/api/community/health?user_id=...` - Returns connection strength analysis and health buckets
- ✅ **Name Resolution**: Unified via `lib/community/names.js` with `getDisplayName`, `userById`, `buildUserIndex`

### **Safety & Security (VERIFIED)**
- ✅ **Read-only**: From `public.*` tables only (taps, users)
- ✅ **Write-only**: To `gamification.*` schema only
- ✅ **Idempotent**: All operations use `ON CONFLICT DO UPDATE`
- ✅ **Timeouts**: Each statement wrapped with `SET LOCAL statement_timeout = '45s'`

---

## 🎯 **RECOMMENDATIONS V1.1 (TUNABLE)**

**State**: Implemented in `/api/community/weekly` and will be tunable.

**Config Keys** (env or JSON):
- `REC_MIN_MUTUALS` (default: 2)
- `REC_MAX_RESULTS` (default: 3) 
- `REC_SCORE_WEIGHTS` with `{mutuals:0.7, recency:0.2, geo:0.1}` defaults
- `REC_MAX_DAYS_FOR_RECENCY` (default: 90)
- `REC_GEO_MAX_KM` (default: 50)
- `REC_BLOCKLIST_IDS`, `REC_BLOCKLIST_USERNAMES`

**Scoring Formula**:
```
score = w_m * f(mutuals) + w_r * f(recency_decay) + w_g * f(geo_proximity)
```

**Scoring Components**:
- **Mutuals**: Normalized by cap (e.g., /10)
- **Recency**: Exponential decay by last interaction (cap at 90d)
- **Geo**: Inverse distance up to `REC_GEO_MAX_KM`

**Debug/Telemetry**: When `debug=1`, return `meta.debug.recs` echoing effective config and top factors used.

---

## 🌍 **TIMEZONE POLICY**

**Global Policy**: Compute server-side in UTC, present/segment in user TZ when provided.

**Endpoint Behavior**:
- Endpoints accept `tz` (IANA, e.g., `America/Chicago`); fallback to profile TZ, else UTC
- **Weekly/Quests**: ISO week boundaries use `tz`
- **Radar**: Hourly buckets use `tz`; include `meta.tz_used` and `meta.debug.boundaries` when `debug=1`
- **Note**: Keep timestamps in UTC in payloads; add local date labels only where applicable
- **Caching**: Responses vary by `tz` (document that we may add `Vary: tz` or bake `tz` into URL)

---

## 🚧 **NEXT DEVELOPMENT TASKS**

> **Note**: Sections A–E (SQL rollups) are **Optional / Phase 2 (nice-to-have)** since current pages use the Data Reader export and server-side aggregation. We already have working endpoints (`/api/community/weekly`, `/api/community/quests`, `/api/community/radar`, `/api/community/health`) that compute metrics without new DB jobs; rollups can come later for cost/perf.

### **A) Improve Weekly User Metrics (Optional / Phase 2)**

#### **A.1 First-Degree New Count**
```sql
-- Replace placeholder 0 with actual new first-degree connections
-- Count pairs that appear for the first time that week
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
)
WHERE iso_week = EXTRACT(week FROM CURRENT_DATE - INTERVAL '1 week')
AND year = EXTRACT(year FROM CURRENT_DATE - INTERVAL '1 week');
```

#### **A.2 Second-Degree Count (Lightweight Approximation)**
```sql
-- Add lightweight 2-hop neighbor approximation
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
)
WHERE iso_week = EXTRACT(week FROM CURRENT_DATE - INTERVAL '1 week')
AND year = EXTRACT(year FROM CURRENT_DATE - INTERVAL '1 week');
```

### **B) Improve Edge Strength**

#### **B.1 True 90-Day Rolling Window**
```sql
-- Update edge_strength to use true 90-day rolling window
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
updated_at = NOW();
```

### **C) Weekly Leaderboard Population**

#### **C.1 Populate Leaderboard Data**
```sql
-- Populate weekly_leaderboard with calculated metrics
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
```

### **D) Logging & Verification**

#### **D.1 Add Metrics Logging**
```sql
-- Add logging query to end of rollup job
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
```

### **E) Optional Scheduler (30-minute intervals)**

#### **E.1 Cloud Scheduler Setup**
```bash
# Optional: Schedule rollup every 30 minutes instead of nightly
gcloud scheduler jobs create http gamification-rollup-30min \
  --schedule="*/30 * * * *" \
  --uri="https://arc-gamification-rollup-xxxxx-uc.a.run.app" \
  --http-method=POST \
  --time-zone="America/New_York" \
  --oidc-service-account-email="arc-refresh-job@arcsocial.iam.gserviceaccount.com"
```

---

## 🎨 **UI BUILD ROADMAP (NOW)**

### **🎯 Quests & Routes (READY)**
**Status**: Show 3 quests with progress bars
**Acceptance**: `/api/community/quests` returns `progress`/`target`/`unit` for each
**Screenshots/Todo**: 
- [ ] Quest cards with progress bars
- [ ] Completion states and animations
- [ ] Quest descriptions and rewards

### **📡 Opportunity Radar (READY)**
**Status**: 24 buckets, top participants in current window
**Acceptance**: `/api/community/radar?hours=24&tz=...` returns 24 buckets, `meta.tz_used`
**Screenshots/Todo**:
- [ ] Activity timeline visualization
- [ ] Top participants cards
- [ ] Surge indicators and alerts

### **🏥 Relationship Health (READY)**
**Status**: List top ~15 connections with `strength_f32` and health buckets
**Acceptance**: `/api/community/health` returns real names and categories
**Screenshots/Todo**:
- [ ] Health dashboard layout
- [ ] Connection strength cards
- [ ] Health bucket visualization

---

## 📋 **DEVELOPMENT CONSTRAINTS**

### **Critical Requirements**
- ✅ **Schema Isolation**: All changes must stay in `gamification.*` schema
- ✅ **No Cross-Dependencies**: Keep SQL blocks standalone (no CTE dependencies)
- ✅ **No users.created_at**: Use only `taps` data (users.created_at doesn't exist)
- ✅ **Statement Timeouts**: Wrap each statement with `SET LOCAL statement_timeout = '45s'`
- ✅ **Idempotent Operations**: Use `ON CONFLICT DO UPDATE` for safety

### **GCloud Command Constraints**
- ✅ **Use**: `--task-timeout` instead of `--timeout`
- ✅ **Avoid**: `--platform=managed` and `--max-instances` (caused errors)
- ✅ **Dockerfile**: Node 20 + `npm install --omit=dev`
- ✅ **Service Account**: `arc-refresh-job@arcsocial.iam.gserviceaccount.com`

---

## 🎯 **DELIVERABLES**

### **1. Updated rollup.sql**
- Implement improvements A.1, A.2, B.1, C.1, D.1
- Maintain safety constraints and timeouts
- Keep operations idempotent and isolated

### **2. Updated index.js**
- Multi-statement execution with proper error handling
- Console logging for metrics verification
- Maintain existing watermark logic

### **3. README Snippet**
- Usage instructions
- Optional scheduler example (E.1)
- Deployment commands with correct flags

---

## 🚀 **READY FOR IMPLEMENTATION**

The gamification system is **production-ready** with:
- ✅ Complete database schema deployed
- ✅ ETL jobs running and verified
- ✅ Data processing confirmed (1,000+ records)
- ✅ Safety constraints validated

**Next Step**: Build UI components for Quests & Routes, Opportunity Radar, and Relationship Health using the live API endpoints.

---

## ⚙️ **CONFIG SURFACE**

### **Environment Variables**
- `DATABASE_URL` - PostgreSQL connection string
- `DATA_READER_URL` - Cloud Run reader service URL
- `DATA_READER_SECRET` - Authentication key for reader service
- `WEEKLY_GOAL_TAPS` - Default weekly tap target (default: 25)

### **Recommendation Tunables**
- `REC_MIN_MUTUALS` - Minimum mutual connections required (default: 2)
- `REC_MAX_RESULTS` - Maximum recommendations returned (default: 3)
- `REC_SCORE_WEIGHTS` - JSON weights for scoring (default: `{"mutuals":0.7,"recency":0.2,"geo":0.1}`)
- `REC_MAX_DAYS_FOR_RECENCY` - Maximum days for recency scoring (default: 90)
- `REC_GEO_MAX_KM` - Maximum distance for geo scoring (default: 50)
- `REC_BLOCKLIST_IDS` - Comma-separated user IDs to block
- `REC_BLOCKLIST_USERNAMES` - Comma-separated usernames to block

### **Timezone Support**
- `TZ` - Default timezone for calculations (IANA format, e.g., `America/Chicago`)
- Endpoints accept `tz` query parameter to override

---

## 🔍 **DIAGNOSTICS**

### **Testing Endpoints**
Test all endpoints with `?debug=1` to see detailed metadata:

```bash
# Weekly Pulse
curl -s "$HOST/api/community/weekly?user_id=$USER&debug=1" | jq '.meta.debug'

# Quests & Routes  
curl -s "$HOST/api/community/quests?user_id=$USER&debug=1" | jq '.meta.debug'

# Opportunity Radar
curl -s "$HOST/api/community/radar?user_id=$USER&hours=24&debug=1" | jq '.meta.debug'

# Relationship Health
curl -s "$HOST/api/community/health?user_id=$USER&debug=1" | jq '.meta.debug'
```

### **Debug Information Available**
- **Boundaries**: Week start/end times, timezone used
- **Counts**: Taps processed, users mapped, connections analyzed
- **Performance**: Duration in milliseconds
- **Recommendations**: Effective config and scoring factors
- **Names**: Resolution success rate and fallback usage