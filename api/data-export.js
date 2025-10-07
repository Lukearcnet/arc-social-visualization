// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Use shared database pool
import pool from '../lib/db.js';

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

export async function handleDataExport() {
  const client = await pool.connect();
  try {
    console.log('📊 Running cloud data export script...');

    await client.query('BEGIN');

    // Fetch taps from PostgreSQL
    const result = await client.query('SELECT * FROM taps ORDER BY time ASC');
    const taps = result.rows;

    // Process taps for geocoding
    const processedTaps = [];
    for (const tap of taps) {
      let formattedLocation = tap.formatted_location;
      if (!formattedLocation && tap.latitude && tap.longitude) {
        formattedLocation = await getGeocodedLocation(tap.latitude, tap.longitude);
        // In a real app, you'd update the DB with the new formatted_location
      }
      processedTaps.push({ ...tap, formatted_location: formattedLocation });
    }

    // Simulate other data processing (users, etc.)
    const users = [...new Set(processedTaps.flatMap(tap => [tap.user1_id, tap.user2_id]))]
      .filter(Boolean)
      .map(id => ({ user_id: id, name: `User ${id}`, home_location: 'Unknown' })); // Placeholder

    const comprehensiveData = {
      taps: processedTaps,
      users: users,
      // Add other data structures as needed
      last_refresh: new Date().toISOString(),
    };

    await client.query('COMMIT');
    console.log('✅ Cloud data export completed.');
    return comprehensiveData;

  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    console.error('❌ Cloud data export failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
