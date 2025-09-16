// Cloud Run Job for ARC data refresh - Preview Build
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

async function getVenueInfo(latitude, longitude) {
  /**
   * Get venue information using Google Places API with caching.
   * Based on the original Python implementation.
   */
  if (!latitude || !longitude || latitude === 0.0 || longitude === 0.0) {
    return {
      venue_name: 'N/A',
      venue_category: 'unknown',
      venue_context: 'N/A'
    };
  }

  try {
    // Use Google Places Nearby Search API
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;
    const params = new URLSearchParams({
      location: `${latitude},${longitude}`,
      radius: '25', // 25 meters for venue matching
      key: GOOGLE_API_KEY,
      type: 'establishment' // Focus on businesses/venues
    });

    console.log(`🔍 Making Google Places API call for ${latitude},${longitude}`);
    const response = await fetch(`${url}?${params}`, { 
      timeout: 15000, // Increased timeout
      headers: {
        'User-Agent': 'ARC-Data-Refresh/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`📡 Google Places API response status: ${data.status}`);

    if (data.status === 'OK' && data.results && data.results.length > 0) {
      console.log(`🏪 Found ${data.results.length} potential venues`);
      
      // Find the most specific venue (prefer businesses over generic locations)
      let bestVenue = null;
      for (const venue of data.results) {
        const venueName = venue.name || 'Unknown Venue';
        const venueTypes = venue.types || [];
        
        // Skip generic city/administrative area results
        const genericTypes = ['locality', 'administrative_area_level_1', 'administrative_area_level_2', 'country'];
        if (genericTypes.some(type => venueTypes.includes(type))) {
          continue;
        }
        
        // Prefer specific business types
        const businessTypes = ['restaurant', 'cafe', 'store', 'shopping_mall', 'bar', 'gym', 'hospital', 'school'];
        if (businessTypes.some(type => venueTypes.includes(type))) {
          bestVenue = venue;
          break;
        }
        
        // If no specific business found, use the first non-generic result
        if (bestVenue === null) {
          bestVenue = venue;
        }
      }
      
      // Fallback to first result if no good venue found
      if (bestVenue === null) {
        bestVenue = data.results[0];
      }
      
      const venueName = bestVenue.name || 'Unknown Venue';
      const venueTypes = bestVenue.types || [];
      
      // Check if venue name is just an address or generic location
      function isGenericLocation(name) {
        if (!name || name === 'Unknown Venue') {
          return true;
        }
        
        // Check for address patterns (numbers followed by street names)
        const addressPattern = /^\d+[-\d]*\s+[A-Za-z\s]+(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Pl|Cir|Ct)$/;
        if (addressPattern.test(name.trim())) {
          return true;
        }
        
        // Check for generic establishment names
        const genericNames = [
          'establishment', 'location', 'place', 'area', 'district',
          'neighborhood', 'community', 'region', 'zone', 'section'
        ];
        if (genericNames.some(generic => name.toLowerCase().includes(generic))) {
          return true;
        }
        
        // Check if it's just a city name or administrative area
        const adminTypes = ['locality', 'administrative_area_level_1', 'administrative_area_level_2', 'country', 'political'];
        if (adminTypes.some(type => venueTypes.includes(type))) {
          return true;
        }
        
        return false;
      }
      
      // If it's a generic location, return N/A
      if (isGenericLocation(venueName)) {
        console.log(`🏪 Generic location detected: ${venueName} -> N/A`);
        return {
          venue_name: 'N/A',
          venue_category: 'unknown',
          venue_context: 'N/A'
        };
      } else {
        // Determine category from types
        let category = 'unknown';
        if (venueTypes.includes('restaurant') || venueTypes.includes('food')) {
          category = 'restaurant';
        } else if (venueTypes.includes('cafe') || venueTypes.includes('coffee')) {
          category = 'cafe';
        } else if (venueTypes.includes('park')) {
          category = 'park';
        } else if (venueTypes.includes('shopping_mall') || venueTypes.includes('store')) {
          category = 'shopping';
        } else if (venueTypes.includes('school') || venueTypes.includes('university')) {
          category = 'education';
        } else if (venueTypes.includes('hospital') || venueTypes.includes('health')) {
          category = 'healthcare';
        } else if (venueTypes.includes('gym') || venueTypes.includes('fitness')) {
          category = 'fitness';
        } else if (venueTypes.includes('bar') || venueTypes.includes('night_club')) {
          category = 'nightlife';
        } else {
          category = 'establishment';
        }
        
        console.log(`🏪 Found venue: ${venueName} (${category})`);
        return {
          venue_name: venueName,
          venue_category: category,
          venue_context: `${venueName} (${category})`
        };
      }
    } else {
      // No venue found, return N/A
      console.log(`🏪 No venues found for ${latitude},${longitude}`);
      return {
        venue_name: 'N/A',
        venue_category: 'unknown',
        venue_context: 'N/A'
      };
    }
  } catch (error) {
    console.error(`❌ Error getting venue info for ${latitude},${longitude}:`, error.message);
    return {
      venue_name: 'N/A',
      venue_category: 'unknown',
      venue_context: 'N/A'
    };
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

    // Query taps with user joins for enriched data
    const tapResult = await client.query(`
      SELECT 
          t.tap_id,
          t.id1 as user1_id,
          t.id2 as user2_id,
          split_part(t.location, ',', 1)::float AS latitude,
          split_part(t.location, ',', 2)::float AS longitude,
          t.location,
          t.time,
          t.formatted_location,
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
      WHERE t.location IS NOT NULL AND t.location != '' AND t.location LIKE '%,%'
      ORDER BY t.time DESC
    `);
    const taps = tapResult.rows;
    rowsProcessed = taps.length;

    console.log(`📊 Fetched ${taps.length} enriched taps from database`);

    // Process taps for geocoding and format
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
      
            // Get venue information from Google Places API
            let venueContext = {
              venue_name: "N/A",
              venue_category: "unknown",
              venue_context: "N/A"
            };
            
            if (tap.latitude && tap.longitude) {
              console.log(`🏪 Getting venue info for tap ${i + 1}/${taps.length}...`);
              venueContext = await getVenueInfo(tap.latitude, tap.longitude);
              
              // Add small delay to avoid rate limiting
              if (i % 10 === 0) {
                console.log(`⏳ Rate limiting pause after ${i + 1} taps...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
      
      // Create enriched tap object matching the expected structure
      const enrichedTap = {
        tap_id: tap.tap_id,
        user1_id: tap.user1_id,
        user1_name: `${tap.user1_first_name || ''} ${tap.user1_last_name || ''}`.trim(),
        user1_username: tap.user1_username || '',
        user1_bio: tap.user1_bio || '',
        user1_home: tap.user1_home || '',
        user1_age: tap.user1_age || '',
        user1_tap_count: tap.user1_tap_count || 0,
        user1_connections_count: tap.user1_connections_count || 0,
        user1_phone_number: tap.user1_phone_number || '',
        user2_id: tap.user2_id,
        user2_name: `${tap.user2_first_name || ''} ${tap.user2_last_name || ''}`.trim(),
        user2_username: tap.user2_username || '',
        user2_bio: tap.user2_bio || '',
        user2_home: tap.user2_home || '',
        user2_age: tap.user2_age || '',
        user2_tap_count: tap.user2_tap_count || 0,
        user2_connections_count: tap.user2_connections_count || 0,
        user2_phone_number: tap.user2_phone_number || '',
        latitude: tap.latitude,
        longitude: tap.longitude,
        location: tap.location || `${tap.latitude},${tap.longitude}`,
        formatted_location: formattedLocation || 'Unknown',
        time: tap.time,
        formatted_time: new Date(tap.time).toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        }),
        venue_context: venueContext
      };
      
      processedTaps.push(enrichedTap);
    }

    // Query all users from database
    const userResult = await client.query(`
      SELECT 
          id,
          first_name,
          last_name,
          username,
          age,
          active,
          pfp_url,
          tap_count,
          connections_count,
          home,
          bio,
          social_urls
      FROM public.users
      ORDER BY id
    `);
    const users = userResult.rows.map(u => ({
      user_id: u.id,
      basic_info: {
        first_name: u.first_name || "",
        last_name:  u.last_name  || "",
        username:   u.username   || "",
        age:        u.age        || "",
        active:     !!u.active
      },
      profile_stats: {
        tap_count:          Number.isFinite(u.tap_count) ? u.tap_count : 0,
        connections_count:  Number.isFinite(u.connections_count) ? u.connections_count : 0,
        pfp_url:            u.pfp_url || null
      },
      home_location: {
        home_location:     u.home || "",
        city:              "",
        state:             "",
        country:           "",
        geographic_context: u.home || ""
      },
      bio_analysis: {
        bio_text:        u.bio || "No bio provided",
        bio_length:      (u.bio || "No bio provided").length,
        has_emoji:       false,
        word_count:      (u.bio || "No bio provided").trim().split(/\s+/).filter(Boolean).length,
        contextual_info: { age_group: "Unknown" },
        bio_summary:     u.bio ? "No patterns detected" : "No bio provided"
      },
      social_urls: {
        x:         u.social_urls?.x ?? null,
        linkedin:  u.social_urls?.linkedin ?? null,
        instagram: u.social_urls?.instagram ?? null
      }
    }));
    
    console.log(`📊 Fetched ${users.length} users from database`);

    const comprehensiveData = {
      // New canonical format
      taps: processedTaps,
      users: users,
      last_refresh: new Date().toISOString(),
      
      // Back-compatibility aliases for existing frontend code
      tap_data: processedTaps,
      user_profiles: users,
      
      // Metadata
      metadata: {
        generated_at: new Date().toISOString(),
        total_taps: processedTaps.length,
        total_users: users.length,
        data_version: "3.0",
        update_frequency: "automated",
        description: "ARC Social Graph enriched data for visualizations"
      }
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

