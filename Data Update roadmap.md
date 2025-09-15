# Data Update Roadmap

## Overview
This document outlines the approach for implementing automated data refresh using Vercel Cron jobs with Google Cloud SQL (PostgreSQL) without requiring local machine dependencies.

## Current Problem
- Using `@vercel/postgres` which is designed for Vercel-managed databases only
- External Google Cloud SQL requires standard PostgreSQL client with proper connection management
- Need to eliminate local machine dependency for data refresh automation

## Solution Architecture

### Core Components
1. **Database**: Keep existing Google Cloud SQL (PostgreSQL) - no migration needed
2. **Client Library**: Switch from `@vercel/postgres` to standard `pg` library
3. **Scheduling**: Vercel Cron jobs trigger API endpoints
4. **Connection Management**: Use connection pooling for serverless functions

### Implementation Strategy

#### Phase 1: Minimal Working Solution
- Replace `@vercel/postgres` with `pg` library
- Create simple API route for data refresh
- Use Vercel Cron for scheduling
- Start without connection pooling (sufficient for low-frequency jobs)

#### Phase 2: Production Optimization
- Add connection pooling (PgBouncer or Prisma Accelerate) if needed
- Implement proper error handling and retry logic
- Add monitoring and logging

## Technical Implementation

### 1. Vercel Configuration (`vercel.json`)
```json
{
  "crons": [
    { "path": "/api/refresh-data", "schedule": "*/15 * * * *" }
  ]
}
```

### 2. API Route (`/api/refresh-data.js`)
```javascript
import { Pool } from 'pg';

// Module-scoped pool for connection reuse
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Idempotent refresh logic:
    // - Refresh materialized views
    // - Update cache tables
    // - Write heartbeat timestamp
    
    await client.query('COMMIT');
    res.status(200).json({ ok: true });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('refresh failed', err);
    res.status(500).json({ ok: false, error: 'refresh failed' });
  } finally {
    client.release();
  }
}
```

### 3. Environment Variables
- `DATABASE_URL`: Existing Google Cloud SQL connection string
- `REFRESH_SECRET`: Authentication secret for cron job security

## Key Principles

### Idempotency
- All refresh operations must be safe to run multiple times
- Use upsert operations instead of inserts
- Include heartbeat timestamps to track last successful run

### Connection Management
- Use connection pooling to prevent connection exhaustion
- Keep transactions short (< 30 seconds)
- Always release connections in finally blocks

### Error Handling
- Implement proper rollback on errors
- Log errors for debugging
- Return appropriate HTTP status codes

## When to Add Connection Pooling

Add PgBouncer or Prisma Accelerate when:
- Increasing cron frequency (e.g., every minute)
- Multiple concurrent cron jobs
- Observing "too many connections" errors
- Slow connection times

## Testing Checklist

1. **Deploy API route and vercel.json**
2. **Manual test**: Hit `/api/refresh-data` endpoint directly
3. **Cron test**: Wait for first scheduled run and verify logs
4. **Database monitoring**: Check Cloud SQL connections during run (should be 1)
5. **Error handling**: Test with invalid database credentials

## Migration Steps

1. **Remove Vercel-specific packages**:
   - Remove `@vercel/postgres` and `@vercel/blob` from dependencies
   - Keep `pg` and `axios` for database and HTTP operations

2. **Update API files**:
   - Replace `@vercel/postgres` imports with `pg`
   - Update connection string usage
   - Implement proper connection pooling

3. **Update frontend**:
   - Modify data loading to use new API endpoints
   - Handle new data structure if needed

4. **Deploy and test**:
   - Deploy to preview environment first
   - Test all endpoints manually
   - Verify cron job execution

## Benefits

- **No local dependency**: Fully cloud-based solution
- **Cost effective**: Uses existing Google Cloud SQL
- **Reliable**: Proper connection management and error handling
- **Scalable**: Can add pooling and optimization as needed
- **Maintainable**: Standard PostgreSQL client with clear patterns

## Future Considerations

- **Monitoring**: Add detailed logging and metrics
- **Alerting**: Set up notifications for failed refreshes
- **Performance**: Monitor and optimize query performance
- **Backup**: Ensure data refresh doesn't impact production queries
