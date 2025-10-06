# Database Integration Guide

## Overview

This guide covers setting up the gamification database tables and ETL jobs for the Community page. The system uses PostgreSQL with Google Cloud SQL and includes automated data rollups.

## 🗄️ Database Schema

### Core Tables Created

1. **user_day_activity** - Daily activity rollups
2. **user_week_activity** - Weekly activity rollups  
3. **user_streaks** - Streak tracking
4. **edge_strength** - Connection strength calculations
5. **home_location_struct** - Parsed home locations
6. **weekly_leaderboard** - Weekly leaderboards
7. **quest_definitions** - Quest system
8. **user_quest_progress** - Quest progress tracking
9. **surge_windows** - Surge detection

### Indexes for Performance

- User activity lookups
- Edge strength calculations
- Location-based queries
- Time-based queries

## 🚀 Setup Instructions

### 1. Database Migration

Run the database setup script to create all tables and populate initial data:

```bash
# Set environment variables
export DATABASE_URL="your-postgres-connection-string"

# Run the setup script
node scripts/setup-gamification-db.js
```

### 2. Verify Setup

The script will:
- Create all gamification tables
- Backfill initial data from existing taps/users
- Run initial ETL job to populate metrics
- Verify the setup completed successfully

### 3. ETL Job Deployment

Deploy the gamification ETL job to Cloud Run:

```bash
# Build and deploy the ETL job
cd cloudrun/gamification
gcloud run deploy arc-gamification-etl \
  --source . \
  --platform managed \
  --region us-central1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --max-instances 1 \
  --set-env-vars="DB_USER=your-db-user,DB_PASS=your-db-pass,DB_NAME=your-db-name,INSTANCE_CONNECTION_NAME=your-instance"
```

### 4. Schedule ETL Job

Set up a Cloud Scheduler job to run the ETL nightly:

```bash
# Create a scheduled job
gcloud scheduler jobs create http gamification-etl \
  --schedule="0 2 * * *" \
  --uri="https://arc-gamification-etl-xxxxx-uc.a.run.app" \
  --http-method=POST \
  --time-zone="America/New_York"
```

## 📊 Data Pipeline

### Daily ETL Process

1. **Edge Strength Calculation**
   - Updates connection strength between users
   - Uses 90-day rolling window
   - Calculates strength score: `0.6*ln(1+taps) + 0.4*exp(-days_since_last_tap/21)`

2. **Daily Activity Rollup**
   - Aggregates daily tap counts
   - Tracks new first-degree connections
   - Updates user streaks

3. **Weekly Activity Rollup**
   - Rolls up daily data to weekly metrics
   - Calculates second-degree connection growth
   - Updates weekly leaderboards

4. **Surge Detection**
   - Identifies high-activity time windows
   - Calculates surge multipliers
   - Tracks unique users in surge areas

### Data Flow

```
Raw Taps/Users → Daily Rollups → Weekly Rollups → Leaderboards → API Endpoints
```

## 🔧 API Integration

### Endpoint Behavior

The Community API endpoints now:

1. **Check for Tables**: Verify gamification tables exist
2. **Fallback to Mock**: Return mock data if tables don't exist
3. **Real Data**: Query actual gamification data when available

### Endpoints Updated

- `/api/community/weekly` - Weekly Pulse data
- `/api/community/quests` - Quest system (scaffolded)
- `/api/community/radar` - Opportunity Radar (scaffolded)
- `/api/community/health` - Relationship Health (scaffolded)

## 📈 Performance Considerations

### Database Optimization

- **Indexes**: Optimized for common query patterns
- **Partitioning**: Consider partitioning large tables by date
- **Connection Pooling**: Uses pg connection pooling
- **Query Optimization**: Efficient queries with proper joins

### ETL Performance

- **Batch Processing**: Processes data in batches
- **Incremental Updates**: Only processes new/changed data
- **Error Handling**: Robust error handling and rollback
- **Monitoring**: Comprehensive logging and metrics

## 🔍 Monitoring & Maintenance

### Health Checks

```sql
-- Check table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE tablename LIKE '%gamification%' OR tablename IN ('user_day_activity', 'user_week_activity');

-- Check data freshness
SELECT 
  MAX(last_updated_at) as last_update,
  COUNT(*) as record_count
FROM user_week_activity;
```

### Maintenance Tasks

1. **Weekly**: Review ETL job logs
2. **Monthly**: Analyze query performance
3. **Quarterly**: Review and optimize indexes
4. **Annually**: Archive old data if needed

## 🚨 Troubleshooting

### Common Issues

1. **Tables Don't Exist**
   - Run the setup script again
   - Check database permissions
   - Verify connection string

2. **ETL Job Fails**
   - Check Cloud Run logs
   - Verify database connectivity
   - Review error messages

3. **API Returns Mock Data**
   - Tables may not exist yet
   - Check API endpoint logs
   - Verify database connection

### Debug Commands

```bash
# Check if tables exist
psql $DATABASE_URL -c "SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%gamification%';"

# Check data counts
psql $DATABASE_URL -c "SELECT COUNT(*) FROM user_week_activity;"

# Test API endpoint
curl "https://your-vercel-app.vercel.app/api/community/weekly?user_id=test-user-id"
```

## 📋 Next Steps

1. **Deploy Database Schema**: Run the setup script
2. **Deploy ETL Job**: Set up Cloud Run job
3. **Schedule ETL**: Configure nightly runs
4. **Test API**: Verify endpoints return real data
5. **Monitor**: Set up monitoring and alerts

## 🎯 Success Metrics

- **Database Setup**: All tables created successfully
- **ETL Job**: Runs nightly without errors
- **API Performance**: <500ms response times
- **Data Accuracy**: Metrics match expected values
- **User Experience**: Community page shows real data

The gamification system is now ready for production use with real data! 🚀
