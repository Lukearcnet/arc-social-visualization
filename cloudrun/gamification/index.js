// Cloud Run Job for Gamification Data Rollups - IMPROVED VERSION
// Nightly ETL job to compute gamification metrics with enhanced calculations
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

// Main processing function
async function processGamificationData() {
  const startedAt = new Date();
  let status = 'success';
  let rowsProcessed = 0;

  const client = await pool.connect();
  try {
    console.log('🎮 Starting improved gamification data rollup...');

    await client.query('BEGIN');

    // Read and execute the improved rollup SQL
    console.log('📊 Executing improved rollup SQL...');
    const rollupSQL = readFileSync(join(__dirname, 'rollup.sql'), 'utf8');
    
    // Split SQL into individual statements and execute with logging
    const statements = rollupSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.includes('SET LOCAL statement_timeout')) {
        console.log(`⏱️ Setting statement timeout: ${statement}`);
        await client.query(statement);
      } else if (statement.includes('UPDATE') || statement.includes('INSERT')) {
        console.log(`🔄 Executing: ${statement.substring(0, 50)}...`);
        const result = await client.query(statement);
        if (result.rowCount) {
          console.log(`✅ Updated ${result.rowCount} rows`);
          rowsProcessed += result.rowCount;
        }
      } else if (statement.includes('SELECT') && statement.includes('ROLLUP_METRICS')) {
        console.log(`📊 Executing metrics query...`);
        const result = await client.query(statement);
        if (result.rows.length > 0) {
          const metrics = result.rows[0];
          console.log('📈 ROLLUP METRICS:');
          console.log(`   👥 Users touched: ${metrics.users_touched}`);
          console.log(`   📅 Days processed: ${metrics.days_processed}`);
          console.log(`   📊 Weeks processed: ${metrics.weeks_processed}`);
          console.log(`   🔗 Edges processed: ${metrics.edges_processed}`);
          console.log(`   ⏰ Completed at: ${metrics.completed_at}`);
        }
      }
    }

    await client.query('COMMIT');
    
    // Log final metrics
    const duration = Date.now() - startedAt.getTime();
    console.log('✅ Improved gamification rollup completed!');
    console.log(`   📊 Total rows processed: ${rowsProcessed}`);
    console.log(`   ⏱️ Duration: ${duration}ms`);
    console.log(`   🎯 Status: ${status}`);

  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    console.error('❌ Improved gamification rollup failed:', error);
    status = 'failed';
    throw error;
  } finally {
    client.release();
    const endedAt = new Date();
    await logGamificationRun(startedAt, endedAt, status, rowsProcessed);
  }
}

// Log gamification run
async function logGamificationRun(startedAt, endedAt, status, rowsProcessed) {
  try {
    const client = await pool.connect();
    await client.query(`
      INSERT INTO gamification_rollup_runs (started_at, ended_at, status, rows_processed)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
    `, [startedAt, endedAt, status, rowsProcessed]);
    client.release();
    console.log('✅ Logged gamification rollup run:', status, rowsProcessed, 'rows processed');
  } catch (error) {
    console.error('❌ Error logging gamification rollup run:', error);
  }
}

// Main execution
async function main() {
  try {
    console.log('🚀 Starting Improved Gamification Rollup Job...');
    await processGamificationData();
    console.log('✅ Improved Gamification Rollup Job completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Improved Gamification Rollup Job failed:', error);
    process.exit(1);
  }
}

// Run the job
main();