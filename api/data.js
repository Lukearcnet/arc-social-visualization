export default async function handler(req, res) {
  try {
    // For now, return mock data. In a real implementation, you might:
    // - Store data in a database table
    // - Use a file system
    // - Call the data-export function directly
    const mockData = {
      taps: [
        {
          tap_id: 1,
          latitude: 40.7128,
          longitude: -74.0060,
          formatted_location: "New York, NY, US",
          time: "2024-01-01T12:00:00Z",
          user1_id: "user1",
          user2_id: "user2",
          user1_name: "John Doe",
          user2_name: "Jane Smith"
        }
      ],
      users: [
        { user_id: "user1", name: "John Doe", home_location: "New York, NY" },
        { user_id: "user2", name: "Jane Smith", home_location: "New York, NY" }
      ],
      last_refresh: new Date().toISOString()
    };

    return res.status(200).json(mockData);

  } catch (error) {
    console.error('❌ Error serving data:', error);
    return res.status(500).json({ error: 'Failed to retrieve data', detail: error.message });
  }
}
