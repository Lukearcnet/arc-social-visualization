# Data Update Roadmap - Phase 3: Cloud Run Job + Scheduler

## Overview
This document outlines the approach for implementing automated data refresh using Google Cloud Run Jobs with Cloud Scheduler, eliminating the need for Vercel → Google Cloud SQL connections and local machine dependencies.

## Goal
Automate refreshes from Google Cloud SQL (Postgres) every 15–30 minutes, process/geocode, and expose results to the Vercel frontend without any local dependence and without Vercel → DB connections.

## Architecture (Authoritative)

### Core Components
1. **Cloud Run Job** (same region as Cloud SQL)
   - Node/TS script using pg via the Cloud SQL connector (no raw SSL params)
   - Does: query → transform → geocode → write output JSON to GCS
   - Idempotent; finishes within Job timeout
   
2. **Cloud Scheduler** (15–30 min)
   - Triggers the Cloud Run Job using OIDC auth with a dedicated service account
   - Retries enabled (exponential backoff)
   
3. **Vercel API** (frontend)
   - Serves the app and fetches JSON over HTTPS from GCS (signed URL)
   - No direct DB access from Vercel
   - Force Node runtime on any route (`export const runtime = 'nodejs'`) and use built-in fetch

## Why This Avoids Past Failures

- **No outbound IP allowlisting** from Vercel to Cloud SQL
- **Cloud SQL connector handles auth/SSL**; no fragile connection strings
- **iOS app untouched**—DB settings unchanged
- **No local machine dependency**—fully cloud-based
- **No Vercel egress IP instability**—uses Google's private networking

## Technical Details

### Regions & Connectivity
- **Cloud Run Job co-located** with Cloud SQL (e.g., us-central1)
- **Connector**: Use Cloud Run's Cloud SQL connection (instance connection name)
- **Secrets**: Store DB creds + Maps API key in Secret Manager; inject as env vars in the Job

### Observability
- **Cloud Logging + Error Reporting**
- **Write a refresh_runs row** with started_at, ended_at, status, rows_processed
- **Idempotency**: Use upserts/MV refresh; safe to re-run
- **Outputs**: Write latest.json and a versioned YYYYMMDD/HHmm.json for rollback

### Data Flow
1. **Cloud Scheduler** triggers Cloud Run Job
2. **Cloud Run Job** connects to Cloud SQL via connector
3. **Processes data** (query, transform, geocode)
4. **Writes output** to Google Cloud Storage (GCS)
5. **Vercel API** fetches data from GCS for frontend

## Practical Notes

### Dependencies
- **Axios**: Don't use it in Vercel routes. Use built-in fetch and ensure `runtime = 'nodejs'`
- **Twilio**: Keep Twilio in main app. Put Cloud Run Job in its own folder with its own package.json (only pg and Job deps)
- **Geocoding**: Volume is small, so caching is optional. Set a daily quota/budget alert in GCP

### Security
- **OIDC authentication** between Cloud Scheduler and Cloud Run Job
- **Secret Manager** for sensitive credentials
- **Private GCS bucket** with signed URLs for Vercel access

## Files to Create/Modify

### Cloud Run Job
- `cloudrun/job/Dockerfile` (Node 20 minimal)
- `cloudrun/job/index.ts` (refresh logic with pg + connector)
- `cloudrun/job/package.json` (minimal dependencies)

### Infrastructure (Optional)
- `infra/` IaC notes for: Cloud Run Job, Scheduler, IAM bindings, GCS bucket, Secret Manager

### Vercel Updates
- `api/data.ts` (fetches latest.json from GCS over HTTPS; no axios; `runtime = 'nodejs'`)
- Remove any Vercel → DB code paths

## Rollout Steps

1. **Create GCS bucket** `arc-data` (private)
2. **Create Secret Manager entries**: DB_USER, DB_PASS, DB_NAME, INSTANCE_CONNECTION_NAME, MAPS_API_KEY
3. **Deploy Cloud Run Job** with Cloud SQL connector enabled; mount secrets as env
4. **Configure Cloud Scheduler** (OIDC service account) to run every 15–30 minutes
5. **Run the Job manually once**; verify latest.json in GCS + a heartbeat row in refresh_runs
6. **Update Vercel api/data.ts** to fetch the GCS JSON; deploy
7. **Add GCP budget/quota alerts** for Maps/geocoding; monitor logs and adjust schedule/timeouts as needed

## Benefits

- **Zero risk to iOS app** - No database settings changes
- **No IP whitelisting headaches** - Uses Google's private networking
- **More reliable** - No Vercel egress IP instability
- **Cost effective** - Cloud Run Jobs are very cheap for scheduled tasks
- **Scalable** - Can handle increased load without connection issues
- **Maintainable** - Clear separation of concerns

## Migration from Previous Approach

### What to Remove
- Vercel cron jobs that connect to database
- `@vercel/postgres` and `@vercel/blob` dependencies
- Direct Vercel → Cloud SQL connection code
- Axios usage in Vercel routes

### What to Keep
- Vercel frontend serving
- Twilio integration
- Google Maps API integration
- Database schema and data

## Future Considerations

- **Monitoring**: Add detailed logging and metrics
- **Alerting**: Set up notifications for failed refreshes
- **Performance**: Monitor and optimize query performance
- **Caching**: Add geocoding cache if volume increases
- **Backup**: Ensure data refresh doesn't impact production queries