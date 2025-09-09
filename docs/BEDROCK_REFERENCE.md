# 🏗️ BEDROCK REFERENCE - ARC Unified Graph Map

## **🎯 PRODUCTION-READY BEDROCKS**

### **8th Bedrock - Map Visualization (PRODUCTION-READY)**
**File**: `8th_bedrock_map.html`  
**Status**: ✅ **PRODUCTION-READY** (Optimized Performance, Clean Console, 90%+ Speed Improvement)  
**Features**: Interactive Map, Venue Detection, Timeline Slider, Degree Filtering, Production Console  
**Performance**: User-centric mode transitions under 1 second (was 10+ seconds)

**Key Optimizations:**
- Removed 7,768 lines of commented-out legacy data
- Fixed syntax errors and restored full functionality
- Implemented production-ready console logging
- Optimized file size from 10,184 lines to 2,416 lines
- Fixed header gray gap issue
- Preserved all map visualization functionality

### **10th Bedrock - Network Visualization (PRODUCTION-READY)**
**File**: `10th_bedrock_network.html`  
**Status**: ✅ **PRODUCTION-READY** (Optimized Performance, Clean Console, 90%+ Speed Improvement)  
**Features**: Network Graph, Dynamic Data Loading, Chat Interface, Timeline Slider, Degree Filtering  
**Performance**: User-centric mode transitions under 1 second (was 10+ seconds)

**Key Optimizations:**
- Fixed "Invalid Date" timeline display issue
- Removed edge info popup functionality
- Implemented production-ready console logging
- Fixed node click initialization issue
- Reduced orbit/rotation speed by 85%
- Optimized user-centric mode performance
- Implemented batch updates for DOM operations
- Replaced 19 individual `nodes.update()` calls with batch operations
- Replaced 19 individual `edges.update()` calls with batch operations

## **🚨 CRITICAL PRESERVATION RULES**

### **NEVER MODIFY THESE FILES DIRECTLY**
- **8th Bedrock**: `8th_bedrock_map.html` - SACRED VERSION
- **10th Bedrock**: `10th_bedrock_network.html` - SACRED VERSION

### **DEVELOPMENT GUIDELINES**
- **ALWAYS create separate versions** for debugging, testing, or development
- **Use descriptive filenames** for new versions (e.g., `unified_bedrock_debug.html`)
- **Only update bedrock versions** when explicitly instructed by user
- **Test thoroughly** before suggesting bedrock updates

## **📊 TECHNICAL DETAILS**

### **Data Loading**
- **Source**: `data/comprehensive_data.json`
- **Format**: Dynamic JSON loading (no hardcoded data)
- **Size**: 246 users, 371 connections
- **Update Process**: See `docs/DATA_REFRESH_GUIDE.md`

### **Dependencies**
- **Vis.js**: `lib/vis-9.1.2/` - Network visualization library
- **Tom-select**: `lib/tom-select/` - Search autocomplete
- **Bindings**: `lib/bindings/` - Utility functions

### **Performance Metrics**
- **User-centric mode**: 10+ seconds → under 1 second (90%+ improvement)
- **Timeline updates**: 10+ seconds → ~64ms (99%+ improvement)
- **Degree filtering**: 1+ seconds → ~18ms (98%+ improvement)
- **File size**: 10,184 lines → 2,416 lines (76% reduction)

## **🔧 DEVELOPMENT NOTES**

### **8th Bedrock Specifics**
- **Map API**: Google Maps integration
- **Venue Detection**: Shows business names vs "N/A" for generic locations
- **Timeline**: Cumulative timeline with marker filtering
- **Search**: User search with autocomplete
- **Degree Filtering**: 1st, 2nd, 3rd degree connections

### **10th Bedrock Specifics**
- **Network Engine**: Vis.js force-directed graph
- **Chat Interface**: Draggable chatbox with minimize/expand
- **Timeline**: Accurate date display with chronological sorting
- **Search**: User search with autocomplete
- **Degree Filtering**: 1st, 2nd, 3rd degree connections
- **Physics**: Optimized for smooth, controlled movement

## **🎯 UNIFIED DEVELOPMENT TARGET**

### **Goal**: Combine both bedrocks into single file with toggle functionality
- **Toggle Buttons**: Map icon (🗺️) and Network icon (🕸️) in top-center
- **State Preservation**: Maintain user selection, filters, timeline position
- **Lazy Loading**: Initialize map/network only when first accessed
- **Performance**: Maintain 90%+ optimization in unified version

### **Implementation Approach**
```javascript
// Toggle between two modes
let currentMode = 'network'; // or 'map'

function switchToMap() {
    // Hide network, show map
    // Initialize map if not already done
    // Preserve user selection and filters
}

function switchToNetwork() {
    // Hide map, show network  
    // Initialize network if not already done
    // Preserve user selection and filters
}
```

## **📝 VERSION HISTORY**

### **8th Bedrock Evolution**
- **Original**: 10,184 lines with massive legacy data
- **Cleaned**: 2,416 lines with production-ready console
- **Optimized**: 90%+ performance improvement
- **Status**: Production-ready

### **10th Bedrock Evolution**
- **Original**: Dynamic data loading with performance issues
- **Optimized**: Batch updates, clean console, fixed timeline
- **Performance**: 90%+ improvement across all operations
- **Status**: Production-ready

---

**🎯 Both bedrocks are production-ready and optimized for unified development**
