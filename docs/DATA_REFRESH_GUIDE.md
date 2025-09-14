# 🔄 DATA REFRESH GUIDE

## 🎯 **QUICK REFERENCE**

**When user says "Refresh the data" or "Update the data":**

1. **Switch to develop branch**: `git checkout develop && git pull origin develop`
2. **Run the data export script**: `cd /Users/lukeblanton/Documents/Force\ Direct\ Graph && python3 src/SQL-based/data_export_for_visualizations.py`
3. **Copy files to Git repo**: `cp /Users/lukeblanton/Documents/Force\ Direct\ Graph/data/SQL-based/comprehensive_data_with_geocoding.json /Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json`
4. **Commit to develop**: `cd /Users/lukeblanton/Documents/arc_unified_graph_map && git add data/comprehensive_data.json && git commit -m "data: refresh" && git push origin develop`
5. **Merge to main**: `git checkout main && git pull origin main && git merge develop && git push origin main`
6. **Test the app**: Open `http://localhost:3063/lib/unified_bedrock_user.html?view=map`

---

## 📋 **DETAILED INSTRUCTIONS**

### **Step 1: Run Data Export Script**
```bash
cd /Users/lukeblanton/Documents/Force\ Direct\ Graph
python3 src/SQL-based/data_export_for_visualizations.py
```

**What this does:**
- ✅ Connects to PostgreSQL database
- ✅ **INCREMENTAL UPDATES**: Only fetches new taps since last export
- ✅ Processes coordinates through Google Geocoding API
- ✅ Converts coordinates to city names (e.g., "Nashville, TN, US")
- ✅ Caches results to avoid repeated API calls
- ✅ Merges new data with existing data
- ✅ Exports to `output/SQL-based/data/comprehensive_data.json`

**Expected output (Incremental):**
```
🔄 Incremental mode: Fetching taps newer than 2025-09-12T18:20:42
🔄 Processing 5 taps with reverse geocoding...
✅ Incremental update complete: 5 new taps added
   📊 Total taps: 1091 (was 1086)
✅ Data exported successfully!
   ⏰ Export timestamp saved: 2025-09-12T19:30:15
```

**Expected output (Full refresh):**
```
🔄 No previous export found, fetching all taps
🔄 Processing 1091 taps with reverse geocoding...
✅ Data exported successfully!
   ⏰ Export timestamp saved: 2025-09-12T19:30:15
```

### **Step 2: Copy to Git Repository**
```bash
cp /Users/lukeblanton/Documents/Force\ Direct\ Graph/data/SQL-based/comprehensive_data_with_geocoding.json /Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json
```

**What this does:**
- ✅ Copies the latest data from the export location to the Git repository
- ✅ Updates the data file that the unified bedrock user app loads from
- ✅ Ensures the app has access to the most current data

### **Step 3: Commit and Push to Git**
```bash
cd /Users/lukeblanton/Documents/arc_unified_graph_map
git add data/comprehensive_data.json
git commit -m "data: refresh with X new taps"
git push origin develop
```

**What this does:**
- ✅ Commits the updated data to Git
- ✅ Triggers Vercel deployment (if configured)
- ✅ Updates the live visualization
- ✅ Preserves data history in version control

### **Step 4: Test the Results**
1. **Open the unified app**: `http://localhost:3063/lib/unified_bedrock_user.html?view=map`
2. **Check console**: Should show current tap count (e.g., 1037 taps)
3. **Click a tap marker**: Should show city names like "Nashville, TN, US" instead of coordinates
4. **Test graph view**: Switch to graph view to verify data consistency

---

## 🔧 **AUTOMATION SCRIPT** (Optional)

Create `update_data.sh` for one-command updates:

```bash
#!/bin/bash
echo "🔄 Refreshing social graph data..."

# Run data export
echo "📊 Exporting data from database..."
cd /Users/lukeblanton/Documents/Force\ Direct\ Graph
python3 src/SQL-based/data_export_for_visualizations.py

# Copy to Git repository
echo "📁 Copying to Git repository..."
cp /Users/lukeblanton/Documents/Force\ Direct\ Graph/data/SQL-based/comprehensive_data_with_geocoding.json /Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json

# Switch to develop branch
echo "🔄 Switching to develop branch..."
cd /Users/lukeblanton/Documents/arc_unified_graph_map
git checkout develop
git pull origin develop

# Commit to develop
echo "📝 Committing to develop..."
git add data/comprehensive_data.json
git commit -m "data: refresh $(date)"
git push origin develop

# Merge to main
echo "🔄 Merging to main branch..."
git checkout main
git pull origin main
git merge develop
git push origin main

echo "✅ Data refresh complete on both branches!"
echo "🌐 Test at: http://localhost:3063/lib/unified_bedrock_user.html?view=map"
```

**Make it executable:**
```bash
chmod +x update_data.sh
```

**Run it:**
```bash
./update_data.sh
```

---

## 📊 **WHAT GETS UPDATED**

### **Data Files Updated:**
- `/Users/lukeblanton/Documents/Force Direct Graph/data/SQL-based/comprehensive_data_with_geocoding.json` - Source file with geocoded data
- `/Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json` - Git repository data file
- **Git version control** - Data changes are tracked and versioned

### **Data Includes:**
- **1037+ taps** (current count, increases with new taps)
- **278+ users** (current count, may increase)
- **Geocoded locations** (coordinates → city names)
- **User profiles** with home locations
- **Timeline data** for slider functionality
- **Venue context** from Google Places API
- **Incremental updates** - Only processes new data since last export

### **Application Changes:**
- **Unified bedrock user app** gets updated data
- **Map view** shows latest tap locations with city names
- **Graph view** reflects current user connections
- **Search functionality** works with updated user profiles
- **All existing functionality** preserved

---

## 🔄 **CROSS-BRANCH DATA SYNC**

### **The Problem:**
Data refreshes sometimes don't appear in the develop branch because:
- Data updates are branch-specific (only update the current branch)
- No automatic sync between `main` and `develop` branches
- Manual merging required to keep both branches in sync

### **The Solution:**
**Always refresh data on develop first, then merge to main:**

```bash
# 1. Start on develop branch
git checkout develop
git pull origin develop

# 2. Run data refresh (as usual)
cd /Users/lukeblanton/Documents/Force\ Direct\ Graph
python3 src/SQL-based/data_export_for_visualizations.py
cp data/SQL-based/comprehensive_data_with_geocoding.json /Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json

# 3. Commit to develop
cd /Users/lukeblanton/Documents/arc_unified_graph_map
git add data/comprehensive_data.json
git commit -m "data: refresh with X new taps"
git push origin develop

# 4. Merge to main
git checkout main
git pull origin main
git merge develop
git push origin main
```

### **Why This Works:**
- ✅ **Develop gets fresh data first** (preview environment updated)
- ✅ **Main gets fresh data via merge** (production environment updated)
- ✅ **Both branches stay in sync** automatically
- ✅ **No stale data issues** between branches

---

## ⚠️ **TROUBLESHOOTING**

### **Common Issues:**

#### **1. "No module named 'psycopg2'"**
```bash
pip install psycopg2-binary
```

#### **2. "Google API key not found"**
- Check `src/SQL-based/data_export_for_visualizations.py` line 528
- Ensure API key is set: `GOOGLE_API_KEY = "AIzaSyBcH54WI4pnOprXTqceQzJ9bHmG9z1Gwo4"`

#### **3. "Database connection failed"**
- Check PostgreSQL is running
- Verify database credentials in `config/database_config.py`

#### **4. "App still shows old data"**
- Clear browser cache (Ctrl+F5 or Cmd+Shift+R)
- Check that the data file was copied to the correct Git repository location
- Verify the Git commit and push completed successfully

#### **5. "Coordinates still showing instead of city names"**
- Verify the data export completed successfully
- Check console shows: `🔍 Sample formatted_location: Nashville, TN, US`
- Ensure files were copied to the Git repository: `/Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json`

#### **6. "No new taps appearing after refresh"**
- Check the incremental export is working by looking for "Incremental mode" in the export output
- Verify new taps exist in the database after the last export timestamp
- Run the verification script to check for new taps since last export

#### **7. "Data refresh not showing in develop branch"**
- **Root cause**: Data was refreshed on wrong branch (main instead of develop)
- **Solution**: Follow the cross-branch sync process above
- **Quick fix**: 
  ```bash
  # If data was refreshed on main, sync to develop
  git checkout develop
  git pull origin develop
  git merge main
  git push origin develop
  ```
- **Prevention**: Always start data refresh on develop branch first

---

## 📈 **PERFORMANCE NOTES**

### **API Usage:**
- **First run**: ~1037 API calls (one per unique coordinate)
- **Subsequent runs**: Much fewer due to caching
- **Google Geocoding API**: Very affordable (<$1 for 1000 requests)

### **Processing Time:**
- **Data export**: ~2-3 minutes for full refresh, ~30 seconds for incremental
- **File copying**: <1 second
- **Git operations**: <5 seconds
- **App update**: Immediate (with cache-busting)

### **Data Size:**
- **Source file**: ~1.4MB (comprehensive_data_with_geocoding.json)
- **Git repo file**: ~1.4MB (comprehensive_data.json)
- **Memory usage**: Minimal impact on the unified app

---

## 🎯 **INTEGRATION WITH EXISTING WORKFLOW**

### **When to Refresh:**
- **New taps added** to database
- **User profiles updated**
- **Location data changes**
- **Before major demonstrations**
- **Weekly maintenance** (recommended)

### **What Stays the Same:**
- **All unified bedrock functionality** preserved
- **Map and network view switching** unchanged
- **User authentication** works with new data
- **Search and filtering** remain the same
- **Loading screen behavior** intact

---

## 🔍 **VERIFICATION PROCESS**

### **Check for New Taps Since Last Export:**
```bash
cd /Users/lukeblanton/Documents/Force\ Direct\ Graph && python3 -c "
import psycopg2
from config.database_config import POSTGRES_CONFIG

# Connect to database
conn = psycopg2.connect(
    host=POSTGRES_CONFIG['host'],
    port=POSTGRES_CONFIG['port'],
    database=POSTGRES_CONFIG['database'],
    user=POSTGRES_CONFIG['username'],
    password=POSTGRES_CONFIG['password']
)

cursor = conn.cursor()

# Check the timestamp file
try:
    with open('output/SQL-based/data/last_export_timestamp.txt', 'r') as f:
        timestamp = f.read().strip()
    print(f'📅 Last export timestamp: {timestamp}')
except:
    print('❌ No timestamp file found')

# Check what taps exist after that timestamp
cursor.execute('''
    SELECT COUNT(*) as count
    FROM taps t
    WHERE t.time > %s
''', (timestamp,))
count_after = cursor.fetchone()[0]
print(f'🔍 Taps after last export: {count_after}')

cursor.close()
conn.close()
"
```

**Expected output:**
- If 0: No new taps since last export
- If >0: New taps available for refresh

---

## 📝 **FOR FUTURE AGENTS**

### **Quick Commands:**
```bash
# Full refresh
cd /Users/lukeblanton/Documents/Force\ Direct\ Graph && python3 src/SQL-based/data_export_for_visualizations.py && cp data/SQL-based/comprehensive_data_with_geocoding.json /Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json && cd /Users/lukeblanton/Documents/arc_unified_graph_map && git add data/comprehensive_data.json && git commit -m "data: refresh" && git push

# Test results
open http://localhost:3063/lib/unified_bedrock_user.html?view=map
```

### **Key Files:**
- **Export script**: `/Users/lukeblanton/Documents/Force Direct Graph/src/SQL-based/data_export_for_visualizations.py`
- **Unified app**: `/Users/lukeblanton/Documents/arc_unified_graph_map/lib/unified_bedrock_user.html`
- **Data file**: `/Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json`

### **Success Indicators:**
- ✅ Console shows current tap count (e.g., 1037 taps)
- ✅ Popup cards show: `Location: Nashville, TN, US` (not coordinates)
- ✅ Both map and graph views work with updated data
- ✅ Search results show home locations
- ✅ Git shows the data file was updated

---

**🎯 This guide ensures consistent data refresh process for all future development work.**
