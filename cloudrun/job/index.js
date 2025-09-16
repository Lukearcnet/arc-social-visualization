import { Pool } from 'pg';
import { Storage } from '@google-cloud/storage';

// Initialize Google Cloud Storage
const storage = new Storage();
const bucketName = 'arc-data-arcsocial';

// Get environment variables from Secret Manager (injected by Cloud Run)
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_NAME = process.env.DB_NAME;
const INSTANCE_CONNECTION_NAME = process.env.INSTANCE_CONNECTION_NAME;
const GOOGLE_API_KEY = process.env.MAPS_API_KEY;

// Create connection pool for Cloud SQL connector
const pool = new Pool({
  host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`, // Cloud SQL connector uses Unix socket
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  max: 1, // Keep pool small for Cloud Run Job
  // No SSL params needed with Cloud SQL connector
});

async function getGeocodedLocation(latitude, longitude) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.status === 'OK' && data.results.length > 0) {
      const addressComponents = data.results[0].address_components;
      let city = '';
      let state = '';
      let country = '';

      for (const component of addressComponents) {
        if (component.types.includes('locality')) {
          city = component.long_name;
        }
        if (component.types.includes('administrative_area_level_1')) {
          state = component.short_name;
        }
        if (component.types.includes('country')) {
          country = component.short_name;
        }
      }
      return `${city}, ${state}, ${country}`;
    }
    return null;
  } catch (error) {
    console.error('Error geocoding:', error);
    return null;
  }
}

async function writeToGCS(data, filename) {
  try {
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(`visualization/${filename}`);
    
    const jsonData = JSON.stringify(data, null, 2);
    await file.save(jsonData, {
      metadata: {
        contentType: 'application/json',
        cacheControl: 'public, max-age=300', // 5 minutes cache
      },
    });
    
    console.log(`✅ Successfully wrote ${filename} to GCS`);
    return true;
  } catch (error) {
    console.error(`❌ Error writing ${filename} to GCS:`, error);
    throw error;
  }
}

async function logRefreshRun(startedAt, endedAt, status, rowsProcessed) {
  const client = await pool.connect();
  try {
    // Create refresh_runs table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_runs (
        id SERIAL PRIMARY KEY,
        started_at TIMESTAMP NOT NULL,
        ended_at TIMESTAMP NOT NULL,
        status VARCHAR(20) NOT NULL,
        rows_processed INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert the refresh run record
    await client.query(
      'INSERT INTO refresh_runs (started_at, ended_at, status, rows_processed) VALUES ($1, $2, $3, $4)',
      [startedAt, endedAt, status, rowsProcessed]
    );

    console.log(`✅ Logged refresh run: ${status}, ${rowsProcessed} rows processed`);
  } catch (error) {
    console.error('❌ Error logging refresh run:', error);
    // Don't throw - this is just logging
  } finally {
    client.release();
  }
}

async function processData() {
  const startedAt = new Date();
  let status = 'success';
  let rowsProcessed = 0;

  const client = await pool.connect();
  try {
    console.log('📊 Starting ARC data refresh...');

    await client.query('BEGIN');

    // Fetch taps from PostgreSQL
    const result = await client.query('SELECT * FROM taps ORDER BY time ASC');
    const taps = result.rows;
    rowsProcessed = taps.length;

    console.log(`📊 Fetched ${taps.length} taps from database`);

    // Process taps for geocoding
    const processedTaps = [];
    for (let i = 0; i < taps.length; i++) {
      const tap = taps[i];
      let formattedLocation = tap.formatted_location;
      
      if (!formattedLocation && tap.latitude && tap.longitude) {
        console.log(`🌍 Geocoding tap ${i + 1}/${taps.length}...`);
        formattedLocation = await getGeocodedLocation(tap.latitude, tap.longitude);
        
        // Update the database with the new formatted_location
        if (formattedLocation) {
          await client.query(
            'UPDATE taps SET formatted_location = $1 WHERE tap_id = $2',
            [formattedLocation, tap.tap_id]
          );
        }
      }
      
      processedTaps.push({ ...tap, formatted_location: formattedLocation });
    }

    // Generate users from taps
    const users = [...new Set(processedTaps.flatMap(tap => [tap.user1_id, tap.user2_id]))]
      .filter(Boolean)
      .map(id => ({ user_id: id, name: `User ${id}`, home_location: 'Unknown' }));

    const comprehensiveData = {
      taps: processedTaps,
      users: users,
      last_refresh: new Date().toISOString(),
    };

    // Write to GCS
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const versionedFilename = `${timestamp}.json`;
    
    await writeToGCS(comprehensiveData, 'latest.json');
    await writeToGCS(comprehensiveData, versionedFilename);

    await client.query('COMMIT');
    console.log('✅ Data refresh completed successfully');

  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    console.error('❌ Data refresh failed:', error);
    status = 'failed';
    throw error;
  } finally {
    client.release();
    const endedAt = new Date();
    await logRefreshRun(startedAt, endedAt, status, rowsProcessed);
  }
}

// Main execution
async function main() {
  try {
    console.log('🚀 Starting ARC Refresh Job...');
    await processData();
    console.log('✅ ARC Refresh Job completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ ARC Refresh Job failed:', error);
    process.exit(1);
  }
}

// Run the job
main();

