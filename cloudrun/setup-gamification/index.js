// Cloud Run Job for Gamification Database Setup
// One-time setup job to create gamification tables and populate initial data
// Date: 2025-01-15

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get environment variables from Secret Manager (injected by Cloud Run)
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_NAME = process.env.DB_NAME;
const INSTANCE_CONNECTION_NAME = process.env.INSTANCE_CONNECTION_NAME;

// Create connection pool for Cloud SQL connector
const pool = new Pool({
  host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`, // Cloud SQL connector uses Unix socket
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  max: 1, // Keep pool small for Cloud Run Job
  // No SSL params needed with Cloud SQL connector
});

async function setupGamificationDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🎮 Setting up gamification database...');
    
    // Read and execute the SQL migration file
    console.log('📊 Executing gamification migration...');
    const migrationSQL = readFileSync(join(__dirname, '../../migrations/001_gamification_setup.sql'), 'utf8');
    
    // Execute the migration
    await client.query(migrationSQL);
    console.log('✅ Migration executed successfully');
    
    // Verify setup
    console.log('🔍 Verifying setup...');
    const tableCount = await client.query(`
      SELECT COUNT(*) as table_count
      FROM information_schema.tables 
      WHERE table_schema = 'gamification'
      AND table_name IN (
        'user_day_activity', 'user_week_activity', 'user_streaks', 
        'edge_strength', 'home_location_struct', 'weekly_leaderboard',
        'quest_definitions', 'user_quest_progress', 'surge_windows'
      )
    `);
    
    const userCount = await client.query('SELECT COUNT(*) as user_count FROM public.users');
    const tapCount = await client.query('SELECT COUNT(*) as tap_count FROM public.taps');
    
    // Check data backfill results
    const homeLocationCount = await client.query('SELECT COUNT(*) as count FROM gamification.home_location_struct');
    const streakCount = await client.query('SELECT COUNT(*) as count FROM gamification.user_streaks');
    const dailyActivityCount = await client.query('SELECT COUNT(*) as count FROM gamification.user_day_activity');
    const weeklyActivityCount = await client.query('SELECT COUNT(*) as count FROM gamification.user_week_activity');
    const edgeStrengthCount = await client.query('SELECT COUNT(*) as count FROM gamification.edge_strength');
    
    console.log(`✅ Setup complete!`);
    console.log(`📊 Tables created: ${tableCount.rows[0].table_count}`);
    console.log(`👥 Users in database: ${userCount.rows[0].user_count}`);
    console.log(`🔗 Taps in database: ${tapCount.rows[0].tap_count}`);
    console.log(`🏠 Home locations backfilled: ${homeLocationCount.rows[0].count}`);
    console.log(`🔥 Streaks calculated: ${streakCount.rows[0].count}`);
    console.log(`📅 Daily activity records: ${dailyActivityCount.rows[0].count}`);
    console.log(`📊 Weekly activity records: ${weeklyActivityCount.rows[0].count}`);
    console.log(`🔗 Edge strength records: ${edgeStrengthCount.rows[0].count}`);
    
  } catch (error) {
    console.error('❌ Error setting up gamification database:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the setup if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupGamificationDatabase()
    .then(() => {
      console.log('🎉 Gamification database setup completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Gamification database setup failed:', error);
      process.exit(1);
    });
}

export { setupGamificationDatabase };