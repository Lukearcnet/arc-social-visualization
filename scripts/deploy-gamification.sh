#!/bin/bash
# Deploy Gamification Database Setup and ETL Jobs
# Date: 2025-01-15

set -e

echo "🎮 Deploying ARC Gamification System..."

# 1. Deploy Database Setup Job
echo "📊 Deploying database setup job..."
cd cloudrun/setup-gamification
gcloud run deploy arc-gamification-setup \
  --source . \
  --platform managed \
  --region us-central1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --max-instances 1 \
  --set-env-vars="DB_USER=$DB_USER,DB_PASS=$DB_PASS,DB_NAME=$DB_NAME,INSTANCE_CONNECTION_NAME=$INSTANCE_CONNECTION_NAME" \
  --add-cloudsql-instances=$INSTANCE_CONNECTION_NAME

echo "✅ Database setup job deployed"

# 2. Run Database Setup
echo "🔧 Running database setup..."
gcloud run jobs execute arc-gamification-setup \
  --region us-central1 \
  --wait

echo "✅ Database setup completed"

# 3. Deploy ETL Job
echo "🔄 Deploying ETL job..."
cd ../gamification
gcloud run deploy arc-gamification-etl \
  --source . \
  --platform managed \
  --region us-central1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --max-instances 1 \
  --set-env-vars="DB_USER=$DB_USER,DB_PASS=$DB_PASS,DB_NAME=$DB_NAME,INSTANCE_CONNECTION_NAME=$INSTANCE_CONNECTION_NAME" \
  --add-cloudsql-instances=$INSTANCE_CONNECTION_NAME

echo "✅ ETL job deployed"

# 4. Schedule ETL Job
echo "⏰ Scheduling ETL job..."
gcloud scheduler jobs create http gamification-etl \
  --schedule="0 2 * * *" \
  --uri="https://arc-gamification-etl-xxxxx-uc.a.run.app" \
  --http-method=POST \
  --time-zone="America/New_York" \
  --oidc-service-account-email="your-service-account@your-project.iam.gserviceaccount.com" \
  || echo "⚠️  Scheduler job may already exist"

echo "✅ ETL job scheduled"

# 5. Run Initial ETL
echo "🚀 Running initial ETL job..."
gcloud run jobs execute arc-gamification-etl \
  --region us-central1 \
  --wait

echo "✅ Initial ETL completed"

echo "🎉 Gamification system deployment completed!"
echo ""
echo "📋 Next steps:"
echo "1. Deploy your Vercel app with the updated Community page"
echo "2. Test the Community page - it should now show real data"
echo "3. Monitor the ETL job runs nightly at 2 AM EST"
echo ""
echo "🔍 To check status:"
echo "- View Cloud Run logs: gcloud run logs tail arc-gamification-etl --region us-central1"
echo "- Check database: Connect to your Cloud SQL instance and query the gamification tables"
