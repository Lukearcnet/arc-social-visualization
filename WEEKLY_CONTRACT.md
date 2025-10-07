# Weekly Community API Data Contract

## API Call Path

**File**: `community_page.html` (lines 649-698)
**Function**: `loadWeeklyPulse()`
**API Endpoint**: `/api/community/weekly?user_id=${this.currentUser.user_id}`
**Response Handling**: Lines 659-698

## Fields Consumed by Each Renderer

### renderWeeklyPulse() (lines 814-871)

**Recap Cards:**
- `recap.first_degree_new.length` → `new-connections-count` (default: 0)
- `recap.second_degree_delta` → `network-growth-count` (default: 0)  
- `recap.community_activity.length` → `community-activity-count` (default: 0)

**Momentum Ring:**
- `momentum.current_streak_days` → `current-streak` (default: 0)

**Weekly Goal Progress:**
- `momentum.weekly_goal.progress` → progress calculation (default: 0)
- `momentum.weekly_goal.target_taps` → target calculation (default: 25)
- Progress percentage: `Math.max(0, Math.min(100, (progress / target) * 100))`

**Meta Information (Debug Mode):**
- `meta.source` → status display
- `meta.duration_ms` → status display  
- `meta.watermark` → status display

### renderLeaderboard() (lines 873-927)

**Data Sources:**
- `leaderboard.new_connections` → connectors tab (default: [])
- `leaderboard.community_builders` → reach tab (default: [])
- `leaderboard.streak_masters` → consistency tab (default: [])

**Item Properties:**
- `item.name` → display name (default: 'Unknown')
- `item.new_first_degree` → connectors count (default: 0)
- `item.delta_second_degree` → reach count (default: 0)
- `item.streak_days` → streak count (default: 0)

**Empty States:**
- Connectors: "No new connections ranked yet this week."
- Reach: "No high-activity builders yet this week."
- Consistency: "No active streaks to show yet."

### renderRecommendations() (lines 929-981)

**Data Source:**
- `recommendations` → recommendations list (default: [])

**Item Properties:**
- `rec.name` → display name (default: 'Unknown User')
- `rec.scores.total` → match percentage (default: 0)
- `rec.mutuals` → mutual connections array (default: [])
- `rec.explain` → explanation text (default: 'No explanation available.')

**Empty State:**
- "No recommendations yet. Check back soon as your network grows."

**Mutuals Display:**
- Shows first 3 mutuals, then "+N more" format
- "No mutuals" if empty array

### renderWarnings() (lines 983-1025)

**Data Source:**
- `warnings` → warning messages array (default: [])

**Warning Types:**
- Geohash warnings: Adds info note to geo expansion card
- General warnings: Shows dismissible banner at bottom

**Banner Content:**
- Joins warnings with " • " separator
- Dismissible with "×" button

## Complete JSON Schema

### TypeScript Interface

```typescript
interface WeeklyPayload {
  source: string;
  generated_at: string;
  week: {
    year: number;
    iso_week: number;
    range: [string, string]; // [startDate, endDate]
  };
  recap: {
    first_degree_new: Array<{
      user_id: string;
      name: string;
      last_tap_at: string;
    }>;
    second_degree_delta: number;
    community_activity: Array<{
      day: string; // YYYY-MM-DD
      taps: number;
    }>;
    geo_expansion: Array<{
      city: string;
      new_taps: number;
    }>;
  };
  momentum: {
    current_streak_days: number;
    longest_streak_days: number;
    weekly_taps: number;
    new_connections: number;
    weekly_goal: {
      progress: number;
      target_taps: number;
    };
  };
  leaderboard: {
    new_connections: Array<{
      user_id: string;
      name: string;
      new_first_degree: number;
      last_tap_at: string;
    }>;
    community_builders: Array<{
      user_id: string;
      name: string;
      delta_second_degree: number;
    }>;
    streak_masters: Array<{
      user_id: string;
      name: string;
      streak_days: number;
    }>;
  };
  recommendations: Array<{
    user_id: string;
    name: string;
    scores: {
      total: number;
    };
    mutuals: string[];
    explain: string;
  }>;
  meta: {
    source: string;
    duration_ms: number;
    user_id: string;
    watermark: string;
    warnings: string[];
  };
}
```

### Zod Schema

```typescript
import { z } from 'zod';

const weeklyPayloadSchema = z.object({
  source: z.string(),
  generated_at: z.string(),
  week: z.object({
    year: z.number(),
    iso_week: z.number(),
    range: z.tuple([z.string(), z.string()])
  }),
  recap: z.object({
    first_degree_new: z.array(z.object({
      user_id: z.string(),
      name: z.string(),
      last_tap_at: z.string()
    })),
    second_degree_delta: z.number(),
    community_activity: z.array(z.object({
      day: z.string(),
      taps: z.number()
    })),
    geo_expansion: z.array(z.object({
      city: z.string(),
      new_taps: z.number()
    }))
  }),
  momentum: z.object({
    current_streak_days: z.number(),
    longest_streak_days: z.number(),
    weekly_taps: z.number(),
    new_connections: z.number(),
    weekly_goal: z.object({
      progress: z.number(),
      target_taps: z.number()
    })
  }),
  leaderboard: z.object({
    new_connections: z.array(z.object({
      user_id: z.string(),
      name: z.string(),
      new_first_degree: z.number(),
      last_tap_at: z.string()
    })),
    community_builders: z.array(z.object({
      user_id: z.string(),
      name: z.string(),
      delta_second_degree: z.number()
    })),
    streak_masters: z.array(z.object({
      user_id: z.string(),
      name: z.string(),
      streak_days: z.number()
    }))
  }),
  recommendations: z.array(z.object({
    user_id: z.string(),
    name: z.string(),
    scores: z.object({
      total: z.number()
    }),
    mutuals: z.array(z.string()),
    explain: z.string()
  })),
  meta: z.object({
    source: z.string(),
    duration_ms: z.number(),
    user_id: z.string(),
    watermark: z.string(),
    warnings: z.array(z.string())
  })
});
```

## Empty States Trigger Rules

### Recap Cards
- **New Connections**: `recap.first_degree_new.length === 0` → Shows "0"
- **Network Growth**: `recap.second_degree_delta === 0` → Shows "0"  
- **Community Activity**: `recap.community_activity.length === 0` → Shows "0"

### Leaderboard Sections
- **New Connections**: `leaderboard.new_connections.length === 0` → "No new connections ranked yet this week."
- **Community Builders**: `leaderboard.community_builders.length === 0` → "No high-activity builders yet this week."
- **Streak Masters**: `leaderboard.streak_masters.length === 0` → "No active streaks to show yet."

### Recommendations
- **Empty Array**: `recommendations.length === 0` → "No recommendations yet. Check back soon as your network grows."

### Warnings
- **No Warnings**: `warnings.length === 0` → No banner displayed
- **Geohash Warning**: `warnings.some(w => w.includes('geohash'))` → Info note on geo card

## Debug Checklist

When cards render as zero, check these keys:

1. **New Connections Count = 0**:
   - `data.recap?.first_degree_new?.length`
   - `data.recap` exists
   - `data.recap.first_degree_new` is array

2. **Network Growth = 0**:
   - `data.recap?.second_degree_delta`
   - `data.recap` exists

3. **Community Activity = 0**:
   - `data.recap?.community_activity?.length`
   - `data.recap` exists
   - `data.recap.community_activity` is array

4. **Current Streak = 0**:
   - `data.momentum?.current_streak_days`
   - `data.momentum` exists

5. **Weekly Goal = 0%**:
   - `data.momentum?.weekly_goal?.progress`
   - `data.momentum?.weekly_goal?.target_taps`
   - `data.momentum` exists
   - `data.momentum.weekly_goal` exists

6. **Leaderboard Empty**:
   - `data.leaderboard?.new_connections?.length`
   - `data.leaderboard?.community_builders?.length`
   - `data.leaderboard?.streak_masters?.length`
   - `data.leaderboard` exists

7. **Recommendations Empty**:
   - `data.recommendations?.length`
   - `data.recommendations` is array

## Console Logging

**Source Logging** (line 661):
```javascript
console.log('Community payload source:', responseData?.source || 'unknown');
```

**Debug Mode Logging** (lines 822-827):
```javascript
if (isDebug) {
  console.log('🔍 Weekly data received:', data);
  console.log('🔍 Data.recap:', data.recap);
  console.log('🔍 Data.recap.first_degree_new:', data.recap?.first_degree_new);
  console.log('🔍 Data.meta:', data.meta);
}
```

**Meta Status Display** (lines 830-840):
- Shows source, duration, and watermark in fixed overlay
- Only visible when `?debug=1` parameter present
