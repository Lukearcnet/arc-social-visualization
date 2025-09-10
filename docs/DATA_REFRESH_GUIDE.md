# 🔄 DATA REFRESH GUIDE

## 🎯 **QUICK REFERENCE**

**When user says "Refresh the data" or "Update the data":**

1. **Run the data export script**: `python3 src/SQL-based/data_export_for_visualizations.py`
2. **Copy to Git repo**: `cp output/SQL-based/data/comprehensive_data.json /Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json`
3. **Commit and push**: `git add data/comprehensive_data.json && git commit -m "Update data" && git push origin main`
4. **Test the unified bedrock**: Open `https://arc-social-visualization.vercel.app`

---

## 📋 **DETAILED INSTRUCTIONS**

### **Step 1: Run Data Export Script**
```bash
cd /Users/lukeblanton/Documents/Force\ Direct\ Graph
python3 src/SQL-based/data_export_for_visualizations.py
```

**What this does:**
- ✅ Connects to PostgreSQL database
- ✅ Fetches latest tap data (currently ~1037 taps)
- ✅ Processes coordinates through Google Geocoding API
- ✅ Converts coordinates to city names (e.g., "Nashville, TN, US")
- ✅ Caches results to avoid repeated API calls
- ✅ Exports to `output/SQL-based/data/comprehensive_data.json`

**Expected output:**
```
Comprehensive data ready: 1037 taps, 280 users
   📍 Geocoded locations: 1021
   🏪 Venue lookups: 1021
✅ Data exported successfully!
   📁 Output directory: output/SQL-based/data
   📄 Comprehensive data: output/SQL-based/data/comprehensive_data.json
```

### **Step 2: Copy to Git Repository**
```bash
cp output/SQL-based/data/comprehensive_data.json /Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json
```

**What this does:**
- ✅ Copies fresh data to Git repository
- ✅ **Root-level unified bedrock** loads from `./data/comprehensive_data.json`
- ✅ **Active files** are in the root directory, not subdirectories

### **Step 3: Commit and Push to Deploy**
```bash
cd /Users/lukeblanton/Documents/arc_unified_graph_map
git add data/comprehensive_data.json
git commit -m "Update data with latest taps and users"
git push origin main
```

**What this does:**
- ✅ Commits the updated data to Git
- ✅ Vercel automatically redeploys with fresh data
- ✅ Unified bedrock gets updated data

### **Step 4: Test the Results**
1. **Open the unified bedrock**: `https://arc-social-visualization.vercel.app`
2. **Check console**: Should show `✅ User data loaded: 1037 taps` (or current count)
3. **Test both map and network views** with fresh data

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

# Copy to Git repo
echo "📁 Copying to Git repository..."
cp output/SQL-based/data/comprehensive_data.json /Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json

# Commit and push
echo "📤 Committing and pushing to deploy..."
cd /Users/lukeblanton/Documents/arc_unified_graph_map
git add data/comprehensive_data.json
git commit -m "Update data with latest taps and users"
git push origin main

echo "✅ Data refresh complete!"
echo "🌐 Test at: https://arc-social-visualization.vercel.app"
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
- `output/SQL-based/data/comprehensive_data.json` - Source file with geocoded data
- `arc_unified_graph_map/data/comprehensive_data.json` - **Root-level Git repository data**
- **Vercel deployment** - Automatically updated via Git push

### **Active Files (Root Level):**
- `unified_bedrock_user.html` - Main entry point
- `8th_bedrock_map_user.html` - Map visualization  
- `10th_bedrock_network_user.html` - Network visualization
- `data/comprehensive_data.json` - Data file

### **Data Includes:**
- **1037 taps** (current count, may increase)
- **280 users** (current count, may increase)
- **Geocoded locations** (coordinates → city names)
- **User profiles** with home locations
- **Timeline data** for slider functionality
- **Venue context** from Google Places API

### **Unified Bedrock Changes:**
- **Map view** shows updated tap data
- **Network view** shows updated user connections
- **Search functionality** works with latest data
- **All existing functionality** preserved

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

#### **4. "Unified bedrock still shows old data"**
- Clear browser cache (Ctrl+F5 or Cmd+Shift+R)
- Check Vercel deployment status
- Verify Git push was successful

#### **5. "Wrong file copied"**
- **Correct source:** `output/SQL-based/data/comprehensive_data.json`
- **Wrong source:** `data/SQL-based/comprehensive_data_with_geocoding.json`
- Always copy from the `output/` directory, not `data/` directory

---

## 📈 **PERFORMANCE NOTES**

### **API Usage:**
- **First run**: ~1037 API calls (one per unique coordinate)
- **Subsequent runs**: Much fewer due to caching
- **Google Geocoding API**: Very affordable (<$1 for 1000 requests)

### **Processing Time:**
- **Data export**: ~2-3 minutes for 1037 taps
- **File copying**: <1 second
- **Git push and Vercel deploy**: ~1-2 minutes

### **Data Size:**
- **Source file**: ~1.3MB (comprehensive_data.json)
- **Git repo file**: ~1.3MB (comprehensive_data.json)
- **Memory usage**: Minimal impact on unified bedrock

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

## 📝 **FOR FUTURE AGENTS**

### **Quick Commands:**
```bash
# Full refresh
cd /Users/lukeblanton/Documents/Force\ Direct\ Graph
python3 src/SQL-based/data_export_for_visualizations.py
cp output/SQL-based/data/comprehensive_data.json /Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json
cd /Users/lukeblanton/Documents/arc_unified_graph_map
git add data/comprehensive_data.json && git commit -m "Update data" && git push origin main

# Test results
open https://arc-social-visualization.vercel.app
```

### **Key Files:**
- **Export script**: `src/SQL-based/data_export_for_visualizations.py`
- **Unified bedrock**: `https://arc-social-visualization.vercel.app`
- **Root-level data**: `arc_unified_graph_map/data/comprehensive_data.json`
- **Active HTML files**: All in root directory (not in subdirectories)

### **Success Indicators:**
- ✅ Console shows: `✅ User data loaded: 1037 taps` (or current count)
- ✅ Map view shows updated tap data
- ✅ Network view shows updated user connections
- ✅ Both views load with fresh data

---

**🎯 This guide ensures consistent data refresh process for all future development work.**
