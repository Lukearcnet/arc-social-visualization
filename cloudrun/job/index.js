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

    // Query taps with user JOINs (replicating Python script)
    console.log('🔄 Fetching taps with user data...');
    const tapsQuery = `
      SELECT 
        t.tap_id,
        t.id1,
        t.id2,
        t.location,
        t.time,
        u1.first_name as user1_first_name,
        u1.last_name as user1_last_name,
        u1.username as user1_username,
        u1.bio as user1_bio,
        u1.home as user1_home,
        u1.age as user1_age,
        u1.tap_count as user1_tap_count,
        u1.connections_count as user1_connections_count,
        u1.phone_number as user1_phone_number,
        u2.first_name as user2_first_name,
        u2.last_name as user2_last_name,
        u2.username as user2_username,
        u2.bio as user2_bio,
        u2.home as user2_home,
        u2.age as user2_age,
        u2.tap_count as user2_tap_count,
        u2.connections_count as user2_connections_count,
        u2.phone_number as user2_phone_number
      FROM taps t
      JOIN users u1 ON t.id1 = u1.id
      JOIN users u2 ON t.id2 = u2.id
      WHERE t.location IS NOT NULL AND t.location != ''
      ORDER BY t.time ASC
    `;
    
    const tapsResult = await client.query(tapsQuery);
    const taps = tapsResult.rows;
    rowsProcessed = taps.length;

    console.log(`📊 Fetched ${taps.length} taps from database`);

    // Query all users (replicating Python script)
    console.log('🔄 Fetching all users...');
    const usersQuery = `
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.username,
        u.bio,
        u.home,
        u.age,
        u.pfp_url,
        u.tap_count,
        u.connections_count,
        u.social_urls,
        u.active
      FROM users u
      ORDER BY u.id DESC
    `;
    
    const usersResult = await client.query(usersQuery);
    const users = usersResult.rows;

    console.log(`📊 Fetched ${users.length} users from database`);

    // Process taps for geocoding
    const processedTaps = [];
    for (let i = 0; i < taps.length; i++) {
      const tap = taps[i];
      
      // Parse location string to coordinates
      let latitude = 0.0;
      let longitude = 0.0;
      let formattedLocation = null;
      
      try {
        if (tap.location && tap.location.includes(',')) {
          const [latStr, lonStr] = tap.location.split(',');
          latitude = parseFloat(latStr.trim());
          longitude = parseFloat(lonStr.trim());
          
          // Get formatted location using reverse geocoding
          if (latitude !== 0.0 && longitude !== 0.0) {
            console.log(`🌍 Geocoding tap ${i + 1}/${taps.length}...`);
            formattedLocation = await getGeocodedLocation(latitude, longitude);
          }
        }
      } catch (error) {
        console.error(`Error processing location for tap ${tap.tap_id}:`, error);
      }
      
      // Create tap object with embedded user data (matching Python script structure)
      const processedTap = {
        tap_id: tap.tap_id,
        user1_id: tap.id1,
        user1_name: `${tap.user1_first_name} ${tap.user1_last_name}`,
        user1_username: tap.user1_username,
        user1_bio: tap.user1_bio,
        user1_home: tap.user1_home,
        user1_age: tap.user1_age,
        user1_tap_count: tap.user1_tap_count,
        user1_connections_count: tap.user1_connections_count,
        user1_phone_number: tap.user1_phone_number,
        user2_id: tap.id2,
        user2_name: `${tap.user2_first_name} ${tap.user2_last_name}`,
        user2_username: tap.user2_username,
        user2_bio: tap.user2_bio,
        user2_home: tap.user2_home,
        user2_age: tap.user2_age,
        user2_tap_count: tap.user2_tap_count,
        user2_connections_count: tap.user2_connections_count,
        user2_phone_number: tap.user2_phone_number,
        latitude: latitude,
        longitude: longitude,
        location: tap.location,
        formatted_location: formattedLocation || "Unknown location",
        time: tap.time,
        formatted_time: new Date(tap.time).toLocaleDateString(),
        venue_context: {
          venue_name: "N/A",
          venue_category: "unknown",
          venue_context: "N/A"
        }
      };
      
      processedTaps.push(processedTap);
    }

    // Process users (matching Python script structure)
    const processedUsers = users.map(user => {
      // Simple home location processing (no complex enrichment for now)
      const homeLocation = {
        home_location: user.home || "Unknown",
        city: "",
        state: "",
        country: "",
        geographic_context: user.home || "Unknown"
      };

      // Simple bio analysis (no complex processing for now)
      const bioAnalysis = {
        bio_text: user.bio || "No bio provided",
        bio_length: (user.bio || "").length,
        has_emoji: /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/u.test(user.bio || ""),
        word_count: (user.bio || "").split(/\s+/).filter(word => word.length > 0).length,
        contextual_info: {
          age_group: user.age || "Unknown"
        },
        bio_summary: user.bio || "No bio provided"
      };

      return {
        user_id: user.id,
        basic_info: {
          first_name: user.first_name,
          last_name: user.last_name,
          username: user.username,
          age: user.age,
          active: user.active
        },
        profile_stats: {
          tap_count: user.tap_count,
          connections_count: user.connections_count,
          pfp_url: user.pfp_url
        },
        home_location: homeLocation,
        bio_analysis: bioAnalysis,
        social_urls: user.social_urls || {}
      };
    });

    // Create comprehensive data structure
    const comprehensiveData = {
      taps: processedTaps,
      users: processedUsers,
      last_refresh: new Date().toISOString(),
    };

    console.log(`✅ Processed ${processedTaps.length} taps and ${processedUsers.length} users`);

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