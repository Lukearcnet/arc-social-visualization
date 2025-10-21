// Cloud Run Job for ARC data refresh - Hybrid Cache Enrichment
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

// Cache structures
let tapCache = new Map(); // tap_id -> {formatted_location, venue_context}
let coordCache = new Map(); // normalized_lat_lng -> {formatted_location, venue_context}
let prevSnapshot = { taps: [], users: [] };

// Metrics tracking
let metrics = {
  prevSnapshotFound: false,
  tapsTotal: 0,
  usersTotal: 0,
  reusedByTapId: 0,
  reusedByCoord: 0,
  geocodeCalls: 0,
  placesCalls: 0,
  startTime: Date.now()
};

// Rate limiting with promise pool
class PromisePool {
  constructor(concurrency = 5) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  async add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    this.running++;
    const { fn, resolve, reject } = this.queue.shift();

    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.running--;
      this.process();
    }
  }
}

const promisePool = new PromisePool(5);

// Retry wrapper with exponential backoff
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      // Exponential backoff with jitter
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      const jitter = Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
      
      console.log(`⚠️ Retry attempt ${attempt}/${maxRetries} after ${delay + jitter}ms delay`);
    }
  }
}

// Read previous snapshot from GCS
async function readPreviousSnapshot() {
  try {
    console.log('📖 Reading previous snapshot from GCS...');
    const bucket = storage.bucket(bucketName);
    const file = bucket.file('visualization/latest.json');
    
    const [data] = await file.download();
    const snapshot = JSON.parse(data.toString());
    
    prevSnapshot = {
      taps: snapshot.taps || snapshot.tap_data || [],
      users: snapshot.users || snapshot.user_profiles || []
    };
    
    metrics.prevSnapshotFound = true;
    console.log(`✅ Previous snapshot loaded: ${prevSnapshot.taps.length} taps, ${prevSnapshot.users.length} users`);
    
    // TEMPORARILY DISABLED: Build caches from previous snapshot
    // buildCaches();
    console.log('⚠️ Cache building DISABLED for one-time re-geocoding of all taps');
    console.log('🔄 All taps will be re-geocoded with fixed function to correct Sept 17+ addresses');
    
  } catch (error) {
    console.log(`⚠️ Could not read previous snapshot: ${error.message}`);
    console.log('🔄 Proceeding with empty caches (first run behavior)');
    metrics.prevSnapshotFound = false;
  }
}

// Build caches from previous snapshot
function buildCaches() {
  console.log('🏗️ Building caches from previous snapshot...');
  
  for (const tap of prevSnapshot.taps) {
    if (tap.tap_id && (tap.formatted_location || tap.venue_context)) {
      // Tap-level cache
      tapCache.set(tap.tap_id, {
        formatted_location: tap.formatted_location,
        venue_context: tap.venue_context
      });
      
      // Coordinate-level cache
      if (tap.latitude && tap.longitude) {
        const coordKey = `${Math.round(tap.latitude * 1000000) / 1000000},${Math.round(tap.longitude * 1000000) / 1000000}`;
        coordCache.set(coordKey, {
          formatted_location: tap.formatted_location,
          venue_context: tap.venue_context
        });
      }
    }
  }
  
  console.log(`📊 Cache built: ${tapCache.size} tap entries, ${coordCache.size} coordinate entries`);
}

// Normalize coordinates for cache key
function normalizeCoords(lat, lng) {
  return `${Math.round(lat * 1000000) / 1000000},${Math.round(lng * 1000000) / 1000000}`;
}

// Geocoding function
async function getGeocodedLocation(latitude, longitude) {
  try {
    const response = await withRetry(async () => {
      const url = `https://maps.googleapis.com/maps/api/geocode/json`;
      const params = new URLSearchParams({
        latlng: `${latitude},${longitude}`,
        key: GOOGLE_API_KEY
      });
      
      const res = await fetch(`${url}?${params}`, { 
        timeout: 10000,
        headers: { 'User-Agent': 'ARC-Data-Refresh/1.0' }
      });
      
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res.json();
    });
    
    if (response.status === 'OK' && response.results && response.results.length > 0) {
      const addressComponents = response.results[0].address_components;
      let city = '';
      let state = '';
      let country = '';

      // Parse address components to extract city, state, country only
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
      
      // Return city-level granularity (e.g., "Nashville, TN, US")
      return `${city}, ${state}, ${country}`;
    }
    return null;
  } catch (error) {
    console.error('Error geocoding:', error);
    return null;
  }
}

// Google Places API function
async function getVenueInfo(latitude, longitude) {
  if (!latitude || !longitude || latitude === 0.0 || longitude === 0.0) {
    return {
      venue_name: 'N/A',
      venue_category: 'unknown',
      venue_context: 'N/A'
    };
  }

  try {
    const response = await withRetry(async () => {
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;
      const params = new URLSearchParams({
        location: `${latitude},${longitude}`,
        radius: '25',
        key: GOOGLE_API_KEY,
        type: 'establishment'
      });
      
      const res = await fetch(`${url}?${params}`, { 
        timeout: 15000,
        headers: { 'User-Agent': 'ARC-Data-Refresh/1.0' }
      });
      
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res.json();
    });
    
    if (response.status === 'OK' && response.results && response.results.length > 0) {
      // Find the best venue (same logic as before)
      let bestVenue = null;
      for (const venue of response.results) {
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
        
        if (bestVenue === null) {
          bestVenue = venue;
        }
      }
      
      if (bestVenue === null) {
        bestVenue = response.results[0];
      }
      
      const venueName = bestVenue.name || 'Unknown Venue';
      const venueTypes = bestVenue.types || [];
      
      // Check if venue name is generic
      function isGenericLocation(name) {
        if (!name || name === 'Unknown Venue') return true;
        
        const addressPattern = /^\d+[-\d]*\s+[A-Za-z\s]+(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Pl|Cir|Ct)$/;
        if (addressPattern.test(name.trim())) return true;
        
        const genericNames = ['establishment', 'location', 'place', 'area', 'district', 'neighborhood', 'community', 'region', 'zone', 'section'];
        if (genericNames.some(generic => name.toLowerCase().includes(generic))) return true;
        
        const adminTypes = ['locality', 'administrative_area_level_1', 'administrative_area_level_2', 'country', 'political'];
        if (adminTypes.some(type => venueTypes.includes(type))) return true;
        
        return false;
      }
      
      if (isGenericLocation(venueName)) {
        return {
          venue_name: 'N/A',
          venue_category: 'unknown',
          venue_context: 'N/A'
        };
      } else {
        // Determine category
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
        
        return {
          venue_name: venueName,
          venue_category: category,
          venue_context: `${venueName} (${category})`
        };
      }
    } else {
      return {
        venue_name: 'N/A',
        venue_category: 'unknown',
        venue_context: 'N/A'
      };
    }
  } catch (error) {
    console.error(`Error getting venue info for ${latitude},${longitude}:`, error.message);
    return {
      venue_name: 'N/A',
      venue_category: 'unknown',
      venue_context: 'N/A'
    };
  }
}

// Write to GCS
async function writeToGCS(data, filename) {
  try {
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(`visualization/${filename}`);
    
    const jsonString = JSON.stringify(data, null, 2);
    await file.save(jsonString, {
      metadata: {
        contentType: 'application/json',
        cacheControl: 'public, max-age=3600'
      }
    });
    
    console.log(`✅ Successfully wrote ${filename} to GCS`);
  } catch (error) {
    console.error(`❌ Error writing to GCS:`, error);
    throw error;
  }
}

// Log refresh run
async function logRefreshRun(startedAt, endedAt, status, rowsProcessed) {
  try {
    const client = await pool.connect();
    await client.query(`
      INSERT INTO refresh_runs (started_at, ended_at, status, rows_processed)
      VALUES ($1, $2, $3, $4)
    `, [startedAt, endedAt, status, rowsProcessed]);
    client.release();
    console.log('✅ Logged refresh run:', status, rowsProcessed, 'rows processed');
  } catch (error) {
    console.error('❌ Error logging refresh run:', error);
  }
}

// Main processing function
async function processData() {
  const startedAt = new Date();
  let status = 'success';
  let rowsProcessed = 0;

  const client = await pool.connect();
  try {
    console.log('📊 Starting ARC data refresh with hybrid cache enrichment...');

    await client.query('BEGIN');

    // 1. Read previous snapshot from GCS
    await readPreviousSnapshot();

    // 2. Query fresh data from database (READ-ONLY)
    console.log('📊 Querying fresh data from database...');
    
    // Query taps with user joins
    const tapResult = await client.query(`
      SELECT 
          t.tap_id,
          t.id1 as user1_id,
          t.id2 as user2_id,
          split_part(t.location, ',', 1)::float AS latitude,
          split_part(t.location, ',', 2)::float AS longitude,
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
      WHERE t.location IS NOT NULL AND t.location != '' AND t.location LIKE '%,%'
      ORDER BY t.time DESC
    `);
    
    const taps = tapResult.rows;
    rowsProcessed = taps.length;
    metrics.tapsTotal = taps.length;

    // Query all users
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
    
    const users = userResult.rows;
    metrics.usersTotal = users.length;

    console.log(`📊 Fetched ${taps.length} taps and ${users.length} users from database`);

    // 3. Enrich taps using hybrid cache approach
    console.log('🔄 Starting hybrid cache enrichment...');
    
    const enrichedTaps = [];
    const enrichmentPromises = [];

    for (let i = 0; i < taps.length; i++) {
      const tap = taps[i];
      const coordKey = normalizeCoords(tap.latitude, tap.longitude);
      
      // Check caches in order
      let formattedLocation = null;
      let venueContext = null;
      let needsGeocoding = false;
      let needsVenueProcessing = false;
      
      // Try tap cache first
      if (tapCache.has(tap.tap_id)) {
        const cached = tapCache.get(tap.tap_id);
        formattedLocation = cached.formatted_location;
        venueContext = cached.venue_context;
        metrics.reusedByTapId++;
        console.log(`♻️ Reused by tap_id: ${tap.tap_id}`);
      }
      // Try coord cache second
      else if (coordCache.has(coordKey)) {
        const cached = coordCache.get(coordKey);
        formattedLocation = cached.formatted_location;
        venueContext = cached.venue_context;
        metrics.reusedByCoord++;
        console.log(`♻️ Reused by coordinates: ${coordKey}`);
      }
      // Need to enrich
      else {
        needsGeocoding = true;
        needsVenueProcessing = true;
      }
      
      // Create enrichment promise if needed
      if (needsGeocoding || needsVenueProcessing) {
        const enrichmentPromise = promisePool.add(async () => {
          let finalFormattedLocation = formattedLocation;
          let finalVenueContext = venueContext;
          
          // Geocoding
          if (needsGeocoding) {
            console.log(`🌍 Geocoding tap ${i + 1}/${taps.length}...`);
            finalFormattedLocation = await getGeocodedLocation(tap.latitude, tap.longitude);
            metrics.geocodeCalls++;
          }
          
          // Venue processing
          if (needsVenueProcessing) {
            console.log(`🏪 Getting venue info for tap ${i + 1}/${taps.length}...`);
            finalVenueContext = await getVenueInfo(tap.latitude, tap.longitude);
            metrics.placesCalls++;
          }
          
          // Update caches
          if (finalFormattedLocation || finalVenueContext) {
            tapCache.set(tap.tap_id, {
              formatted_location: finalFormattedLocation,
              venue_context: finalVenueContext
            });
            
            coordCache.set(coordKey, {
              formatted_location: finalFormattedLocation,
              venue_context: finalVenueContext
            });
          }
          
          return {
            tap,
            formattedLocation: finalFormattedLocation,
            venueContext: finalVenueContext
          };
        });
        
        enrichmentPromises.push(enrichmentPromise);
      } else {
        // Use cached data
        enrichmentPromises.push(Promise.resolve({
          tap,
          formattedLocation,
          venueContext
        }));
      }
    }
    
    // Wait for all enrichments to complete
    console.log(`⏳ Waiting for ${enrichmentPromises.length} enrichment operations...`);
    const enrichmentResults = await Promise.all(enrichmentPromises);
    
    // Build enriched tap objects
    for (const result of enrichmentResults) {
      const { tap, formattedLocation, venueContext } = result;
      
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
        venue_context: venueContext || {
          venue_name: 'N/A',
          venue_category: 'unknown',
          venue_context: 'N/A'
        }
      };
      
      enrichedTaps.push(enrichedTap);
    }

    // Process users (same as before)
    const processedUsers = users.map(u => ({
      user_id: u.id,
      basic_info: {
        first_name: u.first_name || "",
        last_name: u.last_name || "",
        username: u.username || "",
        age: u.age || "",
        active: !!u.active
      },
      profile_stats: {
        tap_count: Number.isFinite(u.tap_count) ? u.tap_count : 0,
        connections_count: Number.isFinite(u.connections_count) ? u.connections_count : 0,
        pfp_url: u.pfp_url || null
      },
      home_location: {
        home_location: u.home || "",
        city: "",
        state: "",
        country: "",
        geographic_context: u.home || ""
      },
      bio_analysis: {
        bio_text: u.bio || "No bio provided",
        bio_length: (u.bio || "No bio provided").length,
        has_emoji: false,
        word_count: (u.bio || "No bio provided").trim().split(/\s+/).filter(Boolean).length,
        contextual_info: { age_group: "Unknown" },
        bio_summary: u.bio ? "No patterns detected" : "No bio provided"
      },
      social_urls: {
        x: u.social_urls?.x ?? null,
        linkedin: u.social_urls?.linkedin ?? null,
        instagram: u.social_urls?.instagram ?? null
      }
    }));

    // 4. Build final output
    const comprehensiveData = {
      // New canonical format
      taps: enrichedTaps,
      users: processedUsers,
      last_refresh: new Date().toISOString(),
      
      // Back-compatibility aliases
      tap_data: enrichedTaps,
      user_profiles: processedUsers,
      
      // Metadata
      metadata: {
        generated_at: new Date().toISOString(),
        total_taps: enrichedTaps.length,
        total_users: processedUsers.length,
        data_version: "2.0",
        update_frequency: "automated",
        description: "ARC Social Graph enriched data for visualizations",
        cache_stats: {
          prev_snapshot_found: metrics.prevSnapshotFound,
          taps_total: metrics.tapsTotal,
          users_total: metrics.usersTotal,
          reused_by_tap_id: metrics.reusedByTapId,
          reused_by_coord: metrics.reusedByCoord,
          geocode_calls: metrics.geocodeCalls,
          places_calls: metrics.placesCalls,
          duration_ms: Date.now() - metrics.startTime
        }
      }
    };

    // 5. Write to GCS
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const versionedFilename = `${timestamp}.json`;
    
    await writeToGCS(comprehensiveData, 'latest.json');
    await writeToGCS(comprehensiveData, versionedFilename);

    await client.query('COMMIT');
    
    // 6. Log metrics
    const duration = Date.now() - metrics.startTime;
    console.log('✅ Processing complete!');
    console.log(`   📊 Total taps: ${metrics.tapsTotal}`);
    console.log(`   👥 Total users: ${metrics.usersTotal}`);
    console.log(`   ♻️ Reused by tap_id: ${metrics.reusedByTapId}`);
    console.log(`   ♻️ Reused by coordinates: ${metrics.reusedByCoord}`);
    console.log(`   🌍 Geocode calls: ${metrics.geocodeCalls}`);
    console.log(`   🏪 Places calls: ${metrics.placesCalls}`);
    console.log(`   ⏱️ Duration: ${duration}ms`);
    console.log(`   💰 API calls saved: ${metrics.tapsTotal - metrics.geocodeCalls - metrics.placesCalls}`);

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
    console.log('🚀 Starting ARC Refresh Job with Hybrid Cache Enrichment...');
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