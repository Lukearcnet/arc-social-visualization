# 🔄 DATA REFRESH GUIDE

## 🎯 **QUICK REFERENCE**

**When user says "Refresh the data" or "Update the data":**

1. **Run the data export script**: `python3 src/SQL-based/data_export_for_visualizations.py`
2. **Copy files to frontend**: `cp data/SQL-based/comprehensive_data_with_geocoding.json data/comprehensive_data.json`
3. **Update output directory**: `cp data/comprehensive_data.json output/SQL-based/data/comprehensive_data.json`
4. **Test the map**: Open `http://localhost:3000/arc_social_graph_map_bedrock_fresh.html`

---

## 📋 **DETAILED INSTRUCTIONS**

### **Step 1: Run Data Export Script**
```bash
cd /Users/lukeblanton/Documents/Force\ Direct\ Graph
python3 src/SQL-based/data_export_for_visualizations.py
```

**What this does:**
- ✅ Connects to PostgreSQL database
- ✅ Fetches latest tap data (currently ~934 taps)
- ✅ Processes coordinates through Google Geocoding API
- ✅ Converts coordinates to city names (e.g., "Nashville, TN, US")
- ✅ Caches results to avoid repeated API calls
- ✅ Exports to `data/SQL-based/comprehensive_data_with_geocoding.json`

**Expected output:**
```
🔄 Processing 934 taps with reverse geocoding...
📍 Geocoded: 36.140892,-86.806279 → Nashville, TN, US
📍 Geocoded: 32.807120,-96.794139 → Dallas, TX, US
...
✅ Data exported with reverse geocoding to: data/SQL-based/comprehensive_data_with_geocoding.json
   Total taps: 934
   Cached coordinates: 923
```

### **Step 2: Copy to Frontend Directory**
```bash
cp data/SQL-based/comprehensive_data_with_geocoding.json data/comprehensive_data.json
```

**What this does:**
- ✅ Makes the new data accessible to the frontend
- ✅ Frontend loads from `./data/comprehensive_data.json`

### **Step 3: Update Output Directory**
```bash
cp data/comprehensive_data.json output/SQL-based/data/comprehensive_data.json
```

**What this does:**
- ✅ Ensures the output directory has the latest data
- ✅ Prevents any caching issues

### **Step 4: Test the Results**
1. **Open the map**: `http://localhost:3000/arc_social_graph_map_bedrock_fresh.html`
2. **Check console**: Should show `✅ Tap data loaded: 934 taps` (or current count)
3. **Click a tap marker**: Should show city names like "Nashville, TN, US" instead of coordinates

---

## 🔧 **AUTOMATION SCRIPT** (Optional)

Create `update_data.sh` for one-command updates:

```bash
#!/bin/bash
echo "🔄 Refreshing social graph data..."

# Run data export
echo "📊 Exporting data from database..."
python3 src/SQL-based/data_export_for_visualizations.py

# Copy to frontend
echo "📁 Copying to frontend directory..."
cp data/SQL-based/comprehensive_data_with_geocoding.json data/comprehensive_data.json

# Update output directory
echo "📁 Updating output directory..."
cp data/comprehensive_data.json output/SQL-based/data/comprehensive_data.json

echo "✅ Data refresh complete!"
echo "🌐 Test at: http://localhost:3000/arc_social_graph_map_bedrock_fresh.html"
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
- `data/SQL-based/comprehensive_data_with_geocoding.json` - Source file with geocoded data
- `data/comprehensive_data.json` - Frontend-accessible data
- `output/SQL-based/data/comprehensive_data.json` - Output directory data

### **Data Includes:**
- **934 taps** (current count, may increase)
- **273 users** (current count, may increase)
- **Geocoded locations** (coordinates → city names)
- **User profiles** with home locations
- **Timeline data** for slider functionality
- **Venue context** from Google Places API

### **Frontend Changes:**
- **Popup cards** show city names instead of coordinates
- **Search results** show home locations
- **Timeline slider** works with latest data
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

#### **4. "Frontend still shows old data"**
- Clear browser cache (Ctrl+F5 or Cmd+Shift+R)
- Check console for cache-busting parameter: `?t=1234567890`

#### **5. "Coordinates still showing instead of city names"**
- Verify the data export completed successfully
- Check console shows: `🔍 Sample formatted_location: Nashville, TN, US`
- Ensure files were copied to correct locations

---

## 📈 **PERFORMANCE NOTES**

### **API Usage:**
- **First run**: ~934 API calls (one per unique coordinate)
- **Subsequent runs**: Much fewer due to caching
- **Google Geocoding API**: Very affordable (<$1 for 1000 requests)

### **Processing Time:**
- **Data export**: ~2-3 minutes for 934 taps
- **File copying**: <1 second
- **Frontend update**: Immediate (with cache-busting)

### **Data Size:**
- **Source file**: ~1.2MB (comprehensive_data_with_geocoding.json)
- **Frontend file**: ~1.2MB (comprehensive_data.json)
- **Memory usage**: Minimal impact on frontend

---

## 🎯 **INTEGRATION WITH EXISTING WORKFLOW**

### **When to Refresh:**
- **New taps added** to database
- **User profiles updated**
- **Location data changes**
- **Before major demonstrations**
- **Weekly maintenance** (recommended)

### **What Stays the Same:**
- **All UI functionality** preserved
- **Search and filtering** unchanged
- **Timeline slider** works with new data
- **Map interactions** remain the same
- **Control panel** functionality intact

---

## 📝 **FOR FUTURE AGENTS**

### **Quick Commands:**
```bash
# Full refresh
python3 src/SQL-based/data_export_for_visualizations.py && cp data/SQL-based/comprehensive_data_with_geocoding.json data/comprehensive_data.json && cp data/comprehensive_data.json output/SQL-based/data/comprehensive_data.json

# Test results
open http://localhost:3000/arc_social_graph_map_bedrock_fresh.html
```

### **Key Files:**
- **Export script**: `src/SQL-based/data_export_for_visualizations.py`
- **Frontend map**: `output/SQL-based/arc_social_graph_map_bedrock_fresh.html`
- **Data files**: `data/comprehensive_data.json`

### **Success Indicators:**
- ✅ Console shows: `✅ Tap data loaded: 934 taps` (or current count)
- ✅ Popup cards show: `Location: Nashville, TN, US` (not coordinates)
- ✅ Search results show home locations
- ✅ Timeline slider works with latest data

---

**🎯 This guide ensures consistent data refresh process for all future development work.**
