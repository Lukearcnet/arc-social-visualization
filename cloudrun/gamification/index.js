// Cloud Run Job for Gamification Data Rollups
// Nightly ETL job to compute gamification metrics
// Date: 2025-01-15

import { Pool } from 'pg';

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
    console.log('🎮 Starting gamification data rollup...');

    await client.query('BEGIN');

    // 1. Update edge strengths for pairs with recent activity
    console.log('📊 Updating edge strengths...');
    const edgeResult = await client.query(`
      UPDATE edge_strength SET
        taps_90d = sub.taps_90d,
        last_tap_at = sub.last_tap_at,
        strength_f32 = 0.6*ln(1+sub.taps_90d) + 0.4*exp(-extract(day from now()-sub.last_tap_at)/21.0),
        updated_at = NOW()
      FROM (
        SELECT 
          id1 as u1, 
          id2 as u2,
          COUNT(*) FILTER (WHERE time >= now()-interval '90 days') AS taps_90d,
          MAX(time) AS last_tap_at
        FROM taps 
        WHERE time >= now()-interval '90 days'
        GROUP BY id1, id2
      ) sub
      WHERE edge_strength.u1 = sub.u1 AND edge_strength.u2 = sub.u2
    `);

    // Insert new edge strengths for new pairs
    await client.query(`
      INSERT INTO edge_strength (u1, u2, taps_90d, last_tap_at, strength_f32, updated_at)
      SELECT 
        id1 as u1,
        id2 as u2,
        COUNT(*) as taps_90d,
        MAX(time) as last_tap_at,
        0.6*ln(1+COUNT(*)) + 0.4*exp(-extract(day from now()-MAX(time))/21.0) as strength_f32,
        NOW() as updated_at
      FROM taps 
      WHERE time >= now()-interval '90 days'
      GROUP BY id1, id2
      ON CONFLICT (u1, u2) DO NOTHING
    `);

    // 2. Update daily activity for yesterday
    console.log('📅 Updating daily activity...');
    await client.query(`
      INSERT INTO user_day_activity (user_id, day, tap_count, first_degree_new_count)
      SELECT 
        u.id as user_id,
        CURRENT_DATE - INTERVAL '1 day' as day,
        COUNT(*) as tap_count,
        COUNT(CASE WHEN t.time >= u.created_at THEN 1 END) as first_degree_new_count
      FROM users u
      LEFT JOIN taps t ON (t.id1 = u.id OR t.id2 = u.id)
      WHERE DATE(t.time) = CURRENT_DATE - INTERVAL '1 day'
      GROUP BY u.id
      ON CONFLICT (user_id, day) DO UPDATE SET
        tap_count = EXCLUDED.tap_count,
        first_degree_new_count = EXCLUDED.first_degree_new_count,
        updated_at = NOW()
    `);

    // 3. Roll up daily activity to weekly
    console.log('📊 Rolling up weekly activity...');
    await client.query(`
      INSERT INTO user_week_activity (user_id, iso_week, year, tap_count, first_degree_new_count, second_degree_count)
      SELECT 
        user_id,
        EXTRACT(week FROM day) as iso_week,
        EXTRACT(year FROM day) as year,
        SUM(tap_count) as tap_count,
        SUM(first_degree_new_count) as first_degree_new_count,
        calculate_second_degree_count(user_id, day) as second_degree_count
      FROM user_day_activity 
      WHERE day >= date_trunc('week', now()-interval '1 week')
      GROUP BY user_id, EXTRACT(week FROM day), EXTRACT(year FROM day)
      ON CONFLICT (user_id, iso_week, year) DO UPDATE SET
        tap_count = EXCLUDED.tap_count,
        first_degree_new_count = EXCLUDED.first_degree_new_count,
        second_degree_count = EXCLUDED.second_degree_count,
        last_updated_at = NOW()
    `);

    // 4. Update weekly leaderboard
    console.log('🏆 Updating weekly leaderboard...');
    await client.query(`
      INSERT INTO weekly_leaderboard (user_id, iso_week, year, new_first_degree, delta_second_degree, streak_days)
      SELECT 
        user_id,
        iso_week,
        year,
        first_degree_new_count as new_first_degree,
        second_degree_count - LAG(second_degree_count) OVER (PARTITION BY user_id ORDER BY iso_week) as delta_second_degree,
        current_streak_days as streak_days
      FROM user_week_activity uwa
      JOIN user_streaks us ON uwa.user_id = us.user_id
      WHERE iso_week = EXTRACT(week FROM NOW())
      ON CONFLICT (user_id, iso_week, year) DO UPDATE SET
        new_first_degree = EXCLUDED.new_first_degree,
        delta_second_degree = EXCLUDED.delta_second_degree,
        streak_days = EXCLUDED.streak_days
    `);

    // 5. Update user streaks
    console.log('🔥 Updating user streaks...');
    await client.query(`
      UPDATE user_streaks SET
        current_streak_days = calculate_current_streak(user_id),
        longest_streak_days = GREATEST(longest_streak_days, calculate_current_streak(user_id)),
        last_tap_at = (
          SELECT MAX(time) 
          FROM taps 
          WHERE id1 = user_streaks.user_id OR id2 = user_streaks.user_id
        ),
        updated_at = NOW()
    `);

    // 6. Detect surge windows
    console.log('🌊 Detecting surge windows...');
    await client.query(`
      INSERT INTO surge_windows (window_id, area_name, start_time, end_time, surge_multiplier, tap_count, unique_users)
      SELECT 
        gen_random_uuid() as window_id,
        hl.city as area_name,
        date_trunc('hour', t.time) as start_time,
        date_trunc('hour', t.time) + interval '1 hour' as end_time,
        COUNT(*)::float / (
          SELECT AVG(hourly_count) 
          FROM (
            SELECT COUNT(*) as hourly_count
            FROM taps t2
            JOIN home_location_struct hl2 ON (hl2.user_id = CASE WHEN t2.id1 = u.id THEN t2.id2 ELSE t2.id1 END)
            WHERE hl2.city = hl.city
            AND t2.time >= now() - interval '7 days'
            GROUP BY date_trunc('hour', t2.time)
          ) hourly_avg
        ) as surge_multiplier,
        COUNT(*) as tap_count,
        COUNT(DISTINCT CASE WHEN t.id1 = u.id THEN t.id2 ELSE t.id1 END) as unique_users
      FROM taps t
      JOIN users u ON (t.id1 = u.id OR t.id2 = u.id)
      JOIN home_location_struct hl ON (hl.user_id = CASE WHEN t.id1 = u.id THEN t.id2 ELSE t.id1 END)
      WHERE t.time >= now() - interval '2 hours'
      AND hl.city IS NOT NULL
      GROUP BY hl.city, date_trunc('hour', t.time)
      HAVING COUNT(*) > 5 -- Minimum activity threshold
      ON CONFLICT DO NOTHING
    `);

    await client.query('COMMIT');
    
    const endedAt = new Date();
    const duration = endedAt - startedAt;
    
    console.log(`✅ Gamification rollup completed successfully in ${duration}ms`);
    
    // Log the run
    await logGamificationRun(startedAt, endedAt, status, rowsProcessed);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error in gamification rollup:', error);
    
    const endedAt = new Date();
    await logGamificationRun(startedAt, endedAt, 'error', 0);
    
    throw error;
  } finally {
    client.release();
  }
}

// Log gamification run
async function logGamificationRun(startedAt, endedAt, status, rowsProcessed) {
  try {
    const client = await pool.connect();
    await client.query(`
      INSERT INTO gamification_runs (started_at, ended_at, status, rows_processed)
      VALUES ($1, $2, $3, $4)
    `, [startedAt, endedAt, status, rowsProcessed]);
    client.release();
  } catch (error) {
    console.error('Error logging gamification run:', error);
  }
}

// Helper function for second degree count calculation
async function createHelperFunctions(client) {
  await client.query(`
    CREATE OR REPLACE FUNCTION calculate_second_degree_count(user_uuid UUID, activity_date DATE)
    RETURNS INTEGER AS $$
    DECLARE
      second_degree_count INTEGER := 0;
    BEGIN
      -- Count unique second-degree connections made on this day
      SELECT COUNT(DISTINCT t2.id2)
      INTO second_degree_count
      FROM taps t1
      JOIN taps t2 ON (t1.id2 = t2.id1 OR t1.id1 = t2.id1)
      WHERE (t1.id1 = user_uuid OR t1.id2 = user_uuid)
      AND DATE(t1.time) = activity_date
      AND t2.id2 != user_uuid
      AND t2.id2 NOT IN (
        SELECT DISTINCT CASE 
          WHEN t1.id1 = user_uuid THEN t1.id2 
          ELSE t1.id1 
        END
        FROM taps t1 
        WHERE (t1.id1 = user_uuid OR t1.id2 = user_uuid)
      );
      
      RETURN COALESCE(second_degree_count, 0);
    END;
    $$ LANGUAGE plpgsql;
  `);
}

// Run the job
if (import.meta.url === `file://${process.argv[1]}`) {
  processGamificationData()
    .then(() => {
      console.log('🎮 Gamification rollup job completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Gamification rollup job failed:', error);
      process.exit(1);
    });
}

export { processGamificationData };
