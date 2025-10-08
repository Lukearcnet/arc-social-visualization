// Test endpoint for quests UI
// GET /api/community/quests-test?scenario=normal|empty|overachievement|error

const handler = async (req, res) => {
  const { scenario = 'normal', user_id } = req.query;
  
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const baseResponse = {
    source: 'test',
    user_id: user_id || 'test-user',
    week: {
      year: 2025,
      iso_week: 41
    },
    meta: {
      duration_ms: 500,
      debug: {
        scenario: scenario,
        test_mode: true
      }
    }
  };
  
  switch (scenario) {
    case 'empty':
      return res.status(200).json({
        ...baseResponse,
        quests: []
      });
      
    case 'overachievement':
      return res.status(200).json({
        ...baseResponse,
        quests: [
          {
            id: 'connect_5',
            title: 'Network Builder',
            progress: 7,
            target: 5,
            unit: 'people'
          },
          {
            id: 'taps_25',
            title: 'Consistency',
            progress: 50,
            target: 25,
            unit: 'taps'
          },
          {
            id: 'streak_3',
            title: 'Keep it going',
            progress: 5,
            target: 3,
            unit: 'days'
          }
        ]
      });
      
    case 'error':
      return res.status(500).json({
        error: 'test_error',
        message: 'Simulated API error for testing'
      });
      
    case 'loading':
      // Simulate very slow response
      await new Promise(resolve => setTimeout(resolve, 3000));
      return res.status(200).json({
        ...baseResponse,
        quests: [
          {
            id: 'connect_5',
            title: 'Network Builder',
            progress: 3,
            target: 5,
            unit: 'people'
          }
        ]
      });
      
    case 'normal':
    default:
      return res.status(200).json({
        ...baseResponse,
        quests: [
          {
            id: 'connect_5',
            title: 'Network Builder',
            progress: 4,
            target: 5,
            unit: 'people'
          },
          {
            id: 'taps_25',
            title: 'Consistency',
            progress: 6,
            target: 25,
            unit: 'taps'
          },
          {
            id: 'streak_3',
            title: 'Keep it going',
            progress: 2,
            target: 3,
            unit: 'days'
          }
        ]
      });
  }
};

handler.config = { runtime: 'nodejs' };
module.exports = handler;
