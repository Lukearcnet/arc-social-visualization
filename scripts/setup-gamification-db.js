#!/usr/bin/env node
// Database setup script for gamification tables
// Run this script to create all gamification tables and populate initial data
// Date: 2025-01-15

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function setupGamificationDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🎮 Setting up gamification database...');
    
    // 1. Create tables
    console.log('📊 Creating gamification tables...');
    const createTablesSQL = readFileSync(join(__dirname, '../migrations/001_create_gamification_tables.sql'), 'utf8');
    await client.query(createTablesSQL);
    console.log('✅ Tables created successfully');
    
    // 2. Backfill data
    console.log('📈 Backfilling initial data...');
    const backfillSQL = readFileSync(join(__dirname, '../migrations/002_backfill_gamification_data.sql'), 'utf8');
    await client.query(backfillSQL);
    console.log('✅ Data backfilled successfully');
    
    // 3. Verify setup
    console.log('🔍 Verifying setup...');
    const tableCount = await client.query(`
      SELECT COUNT(*) as table_count
      FROM information_schema.tables 
      WHERE table_name IN (
        'user_day_activity', 'user_week_activity', 'user_streaks', 
        'edge_strength', 'home_location_struct', 'weekly_leaderboard',
        'quest_definitions', 'user_quest_progress', 'surge_windows'
      )
    `);
    
    const userCount = await client.query('SELECT COUNT(*) as user_count FROM users');
    const tapCount = await client.query('SELECT COUNT(*) as tap_count FROM taps');
    
    console.log(`✅ Setup complete!`);
    console.log(`📊 Tables created: ${tableCount.rows[0].table_count}`);
    console.log(`👥 Users in database: ${userCount.rows[0].user_count}`);
    console.log(`🔗 Taps in database: ${tapCount.rows[0].tap_count}`);
    
    // 4. Run initial ETL
    console.log('🔄 Running initial ETL job...');
    const { processGamificationData } = await import('../cloudrun/gamification/index.js');
    await processGamificationData();
    console.log('✅ Initial ETL completed');
    
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
