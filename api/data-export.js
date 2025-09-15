import { put, get } from '@vercel/blob';
import { createClient } from '@vercel/postgres';

export async function refreshData() {
  console.log('📊 Starting data export process...');
  
  try {
    // Connect to PostgreSQL database
    const client = await createClient({
      connectionString: process.env.POSTGRES_CONNECTION_STRING
    });
    
    await client.connect();
    console.log('✅ Connected to PostgreSQL database');
    
    // Get the last export timestamp
    let lastExportTime = null;
    try {
      const timestampBlob = await get('last_export_timestamp.txt');
      lastExportTime = timestampBlob.text();
      console.log('📅 Last export timestamp:', lastExportTime);
    } catch (error) {
      console.log('📅 No previous export found, fetching all taps');
    }
    
    // Query for new taps since last export
    let query, params;
    if (lastExportTime) {
      query = `
        SELECT 
          t.id,
          t.user_id,
          t.venue_id,
          t.time,
          t.latitude,
          t.longitude,
          u.username,
          u.home_latitude,
          u.home_longitude,
          v.name as venue_name,
          v.latitude as venue_latitude,
          v.longitude as venue_longitude
        FROM taps t
        LEFT JOIN users u ON t.user_id = u.id
        LEFT JOIN venues v ON t.venue_id = v.id
        WHERE t.time > $1
        ORDER BY t.time ASC
      `;
      params = [lastExportTime];
    } else {
      query = `
        SELECT 
          t.id,
          t.user_id,
          t.venue_id,
          t.time,
          t.latitude,
          t.longitude,
          u.username,
          u.home_latitude,
          u.home_longitude,
          v.name as venue_name,
          v.latitude as venue_latitude,
          v.longitude as venue_longitude
        FROM taps t
        LEFT JOIN users u ON t.user_id = u.id
        LEFT JOIN venues v ON t.venue_id = v.id
        ORDER BY t.time ASC
      `;
      params = [];
    }
    
    const result = await client.query(query, params);
    const newTaps = result.rows;
    
    console.log(`🔍 Found ${newTaps.length} new taps to process`);
    
    if (newTaps.length === 0) {
      console.log('✅ No new taps to process');
      await client.end();
      return { message: 'No new data to process', tapCount: 0 };
    }
    
    // Process taps with geocoding
    const processedTaps = await processTapsWithGeocoding(newTaps);
    
    // Get existing data
    let existingData = { taps: [], users: [] };
    try {
      const dataBlob = await get('comprehensive_data.json');
      existingData = JSON.parse(await dataBlob.text());
      console.log(`📊 Loaded existing data: ${existingData.taps.length} taps, ${existingData.users.length} users`);
    } catch (error) {
      console.log('📊 No existing data found, starting fresh');
    }
    
    // Merge new data with existing data
    const mergedData = mergeData(existingData, processedTaps);
    
    // Save updated data to Vercel Blob
    const dataJson = JSON.stringify(mergedData, null, 2);
    await put('comprehensive_data.json', dataJson, {
      access: 'public',
      contentType: 'application/json'
    });
    
    // Save new timestamp
    const newTimestamp = new Date().toISOString();
    await put('last_export_timestamp.txt', newTimestamp, {
      access: 'public',
      contentType: 'text/plain'
    });
    
    await client.end();
    
    console.log(`✅ Data export completed: ${processedTaps.length} new taps processed`);
    console.log(`📊 Total taps: ${mergedData.taps.length}, Total users: ${mergedData.users.length}`);
    
    return {
      message: 'Data refresh completed successfully',
      newTapsProcessed: processedTaps.length,
      totalTaps: mergedData.taps.length,
      totalUsers: mergedData.users.length,
      timestamp: newTimestamp
    };
    
  } catch (error) {
    console.error('❌ Data export failed:', error);
    throw error;
  }
}

async function processTapsWithGeocoding(taps) {
  console.log('🌍 Processing taps with reverse geocoding...');
  
  const processedTaps = [];
  const geocodingCache = new Map();
  
  for (const tap of taps) {
    try {
      // Create a cache key for this coordinate
      const coordKey = `${tap.latitude},${tap.longitude}`;
      
      let formattedLocation;
      if (geocodingCache.has(coordKey)) {
        formattedLocation = geocodingCache.get(coordKey);
      } else {
        // Use Google Geocoding API
        formattedLocation = await reverseGeocode(tap.latitude, tap.longitude);
        geocodingCache.set(coordKey, formattedLocation);
      }
      
      const processedTap = {
        id: tap.id,
        user_id: tap.user_id,
        venue_id: tap.venue_id,
        time: tap.time,
        latitude: tap.latitude,
        longitude: tap.longitude,
        formatted_location: formattedLocation,
        username: tap.username,
        venue_name: tap.venue_name,
        venue_latitude: tap.venue_latitude,
        venue_longitude: tap.venue_longitude
      };
      
      processedTaps.push(processedTap);
      
    } catch (error) {
      console.error(`❌ Failed to process tap ${tap.id}:`, error);
      // Still add the tap without geocoding
      processedTaps.push({
        id: tap.id,
        user_id: tap.user_id,
        venue_id: tap.venue_id,
        time: tap.time,
        latitude: tap.latitude,
        longitude: tap.longitude,
        formatted_location: `${tap.latitude}, ${tap.longitude}`,
        username: tap.username,
        venue_name: tap.venue_name,
        venue_latitude: tap.venue_latitude,
        venue_longitude: tap.venue_longitude
      });
    }
  }
  
  console.log(`✅ Processed ${processedTaps.length} taps with geocoding`);
  return processedTaps;
}

async function reverseGeocode(latitude, longitude) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('Google API key not found');
  }
  
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${apiKey}`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK' || !data.results.length) {
    return `${latitude}, ${longitude}`;
  }
  
  const result = data.results[0];
  const addressComponents = result.address_components;
  
  // Extract city, state, country
  let city = '';
  let state = '';
  let country = '';
  
  for (const component of addressComponents) {
    if (component.types.includes('locality')) {
      city = component.long_name;
    } else if (component.types.includes('administrative_area_level_1')) {
      state = component.short_name;
    } else if (component.types.includes('country')) {
      country = component.short_name;
    }
  }
  
  return `${city}, ${state}, ${country}`;
}

function mergeData(existingData, newTaps) {
  // Create a map of existing taps by ID for quick lookup
  const existingTapsMap = new Map();
  existingData.taps.forEach(tap => {
    existingTapsMap.set(tap.id, tap);
  });
  
  // Add new taps, avoiding duplicates
  const allTaps = [...existingData.taps];
  newTaps.forEach(tap => {
    if (!existingTapsMap.has(tap.id)) {
      allTaps.push(tap);
    }
  });
  
  // Create a map of users
  const usersMap = new Map();
  allTaps.forEach(tap => {
    if (tap.username) {
      usersMap.set(tap.user_id, {
        id: tap.user_id,
        username: tap.username,
        home_latitude: tap.home_latitude,
        home_longitude: tap.home_longitude
      });
    }
  });
  
  return {
    taps: allTaps,
    users: Array.from(usersMap.values()),
    last_updated: new Date().toISOString()
  };
}
