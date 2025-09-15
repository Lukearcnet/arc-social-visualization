import { sql } from '@vercel/postgres';
import axios from 'axios';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

async function getGeocodedLocation(latitude, longitude) {
  const cacheKey = `${latitude},${longitude}`;
  // In a real scenario, you'd use a persistent cache (e.g., Redis, another Blob)
  // For now, we'll simulate or re-fetch.
  // For Vercel Blob, you might store a JSON object of cached locations.

  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        latlng: `${latitude},${longitude}`,
        key: GOOGLE_API_KEY,
      },
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const addressComponents = response.data.results[0].address_components;
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
  try {
    console.log('📊 Running cloud data export script...');

    // Fetch taps from PostgreSQL
    const { rows: taps } = await sql`SELECT * FROM taps ORDER BY time ASC;`;

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

    console.log('✅ Cloud data export completed.');
    return comprehensiveData;

  } catch (error) {
    console.error('❌ Cloud data export failed:', error);
    throw error;
  }
}
