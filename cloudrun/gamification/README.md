# 🎮 Gamification ETL Job - Improved Version

## 📋 Overview

This Cloud Run job implements the improved gamification rollup with enhanced weekly metrics, edge strength calculations, and leaderboard population.

## 🚀 Deployment

### Build and Deploy
```bash
# Build the image
docker build -t gcr.io/arcsocial/arc-gamification-rollup:latest .

# Push to registry
docker push gcr.io/arcsocial/arc-gamification-rollup:latest

# Deploy the job
gcloud run jobs create arc-gamification-rollup \
  --image=gcr.io/arcsocial/arc-gamification-rollup:latest \
  --region=us-central1 \
  --memory=2Gi \
  --cpu=2 \
  --task-timeout=3600 \
  --service-account=arc-refresh-job@arcsocial.iam.gserviceaccount.com \
  --set-secrets="DB_USER=DB_USER:latest,DB_PASS=DB_PASS:latest,DB_NAME=DB_NAME:latest,INSTANCE_CONNECTION_NAME=INSTANCE_CONNECTION_NAME:latest" \
  --set-cloudsql-instances=arcsocial:us-central1:arc
```

### Execute the Job
```bash
# Run the rollup job
gcloud run jobs execute arc-gamification-rollup --region=us-central1 --wait
```

## 📊 Improvements Implemented

### A) Enhanced Weekly Metrics
- **A.1 First-Degree New Count**: Replaces placeholder with actual new connection counting
- **A.2 Second-Degree Count**: Lightweight approximation of 2-hop neighbors

### B) Improved Edge Strength
- **B.1 True 90-Day Window**: Uses actual 90-day rolling window instead of cumulative

### C) Weekly Leaderboard
- **C.1 Leaderboard Population**: Populates with calculated metrics from weekly activity

### D) Logging & Verification
- **D.1 Metrics Logging**: Detailed console output of processing metrics

## ⏰ Scheduling (Optional)

### Nightly Schedule (Default)
```bash
gcloud scheduler jobs create http gamification-rollup-nightly \
  --schedule="0 2 * * *" \
  --uri="https://arc-gamification-rollup-xxxxx-uc.a.run.app" \
  --http-method=POST \
  --time-zone="America/New_York" \
  --oidc-service-account-email="arc-refresh-job@arcsocial.iam.gserviceaccount.com"
```

### 30-Minute Schedule (High Frequency)
```bash
gcloud scheduler jobs create http gamification-rollup-30min \
  --schedule="*/30 * * * *" \
  --uri="https://arc-gamification-rollup-xxxxx-uc.a.run.app" \
  --http-method=POST \
  --time-zone="America/New_York" \
  --oidc-service-account-email="arc-refresh-job@arcsocial.iam.gserviceaccount.com"
```

## 🔧 Configuration

### Environment Variables
- `DB_USER`: Database username (from Secret Manager)
- `DB_PASS`: Database password (from Secret Manager)
- `DB_NAME`: Database name (from Secret Manager)
- `INSTANCE_CONNECTION_NAME`: Cloud SQL instance connection name (from Secret Manager)

### Database Connection
- Uses Cloud SQL connector via Unix socket: `/cloudsql/${INSTANCE_CONNECTION_NAME}`
- No SSL parameters needed with Cloud SQL connector
- Connection pool size: 1 (optimized for Cloud Run Jobs)

## 📈 Expected Output

### Console Logs
```
🎮 Starting improved gamification data rollup...
📊 Executing improved rollup SQL...
⏱️ Setting statement timeout: SET LOCAL statement_timeout = '45s'
🔄 Executing: UPDATE gamification.user_week_activity...
✅ Updated 654 rows
📈 ROLLUP METRICS:
   👥 Users touched: 1,037
   📅 Days processed: 7
   📊 Weeks processed: 1
   🔗 Edges processed: 667
   ⏰ Completed at: 2025-01-15 19:08:35+00
✅ Improved gamification rollup completed!
   📊 Total rows processed: 1,328
   ⏱️ Duration: 2,450ms
   🎯 Status: success
```

### Database Updates
- `gamification.user_week_activity`: Enhanced with real first-degree and second-degree counts
- `gamification.edge_strength`: Updated with true 90-day rolling window
- `gamification.weekly_leaderboard`: Populated with calculated metrics
- `gamification_rollup_runs`: Logged execution metrics

## 🛡️ Safety Features

- **Statement Timeouts**: Each operation wrapped with 45-second timeout
- **Idempotent Operations**: All operations use `ON CONFLICT DO UPDATE`
- **Schema Isolation**: Only writes to `gamification.*` schema
- **Read-Only Source**: Only reads from `public.*` tables
- **Transaction Safety**: Full BEGIN/COMMIT/ROLLBACK protection

## 🔍 Monitoring

### Check Job Status
```bash
# View recent executions
gcloud run jobs executions list --job=arc-gamification-rollup --region=us-central1

# View logs
gcloud run jobs logs tail arc-gamification-rollup --region=us-central1
```

### Database Verification
```sql
-- Check rollup metrics
SELECT * FROM gamification_rollup_runs ORDER BY started_at DESC LIMIT 5;

-- Check weekly activity
SELECT COUNT(*) FROM gamification.user_week_activity WHERE last_updated_at >= NOW() - INTERVAL '1 hour';

-- Check edge strength updates
SELECT COUNT(*) FROM gamification.edge_strength WHERE updated_at >= NOW() - INTERVAL '1 hour';
```
