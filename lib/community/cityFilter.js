// lib/community/cityFilter.js
// Shared city filtering utility for Community endpoints
// Date: 2025-01-15

// City coordinates for filtering
const MAJOR_CITIES = {
  'NY': { lat: 40.7128, lng: -74.0060, name: 'New York' },
  'London': { lat: 51.5074, lng: -0.1278, name: 'London' },
  'LA': { lat: 34.0522, lng: -118.2437, name: 'Los Angeles' },
  'SF': { lat: 37.7749, lng: -122.4194, name: 'San Francisco' },
  'Dallas': { lat: 32.7767, lng: -96.7970, name: 'Dallas' },
  'Chicago': { lat: 41.8781, lng: -87.6298, name: 'Chicago' },
  'Jackson Hole': { lat: 43.4799, lng: -110.7624, name: 'Jackson Hole' },
  'Austin': { lat: 30.2672, lng: -97.7431, name: 'Austin' },
  'Nashville': { lat: 36.1627, lng: -86.7816, name: 'Nashville' },
  'Vanderbilt': { lat: 36.14375, lng: -86.80444, name: 'Vanderbilt University' }
};

// Distance calculation using Haversine formula
function getDistanceFromLatLonInMiles(lat1, lon1, lat2, lon2) {
  const R = 3959; // Radius of the earth in miles
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI/180);
}

// Check if a tap is within city radius
function isWithinCityRadius(latitude, longitude, cityCode, radiusMiles = 50) {
  if (!cityCode || !latitude || !longitude) {
    return true; // No city filter or missing coordinates
  }
  
  const city = MAJOR_CITIES[cityCode];
  if (!city) {
    return true; // Unknown city, don't filter
  }
  
  // Use 0.5 mile radius for Vanderbilt University
  const effectiveRadius = cityCode === 'Vanderbilt' ? 0.5 : radiusMiles;
  
  const distance = getDistanceFromLatLonInMiles(
    latitude,
    longitude,
    city.lat,
    city.lng
  );
  
  return distance <= effectiveRadius;
}

// Filter taps by city
function filterTapsByCity(taps, cityCode) {
  if (!cityCode) {
    return taps; // No city filter
  }
  
  return taps.filter(tap => {
    return isWithinCityRadius(tap.latitude, tap.longitude, cityCode);
  });
}

// Get city name from code
function getCityName(cityCode) {
  return MAJOR_CITIES[cityCode]?.name || cityCode;
}

// Get all available cities
function getAvailableCities() {
  return Object.entries(MAJOR_CITIES).map(([code, data]) => ({
    code,
    name: data.name,
    lat: data.lat,
    lng: data.lng
  }));
}

module.exports = {
  MAJOR_CITIES,
  getDistanceFromLatLonInMiles,
  isWithinCityRadius,
  filterTapsByCity,
  getCityName,
  getAvailableCities
};
