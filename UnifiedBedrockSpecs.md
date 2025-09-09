# Unified Bedrock Specifications

## Overview
Create a unified interface where users can toggle between the 8th bedrock (Map) and 10th bedrock (Network) visualizations using iframe embedding for maximum robustness and maintainability.

## Implementation Status: ✅ COMPLETED

### Final Architecture
- **Iframe-based approach**: Direct embedding of original `8th_bedrock_map.html` and `10th_bedrock_network.html`
- **Single wrapper file**: `unified_bedrock.html` serves as lightweight container
- **Automatic updates**: Changes to original bedrocks automatically reflect in unified interface
- **Zero code duplication**: No copied code, only iframe references

## Core Requirements

### 1. Interface Layout ✅
- **Single viewport** that switches between the two visualizations
- **Toggle buttons positioned** at top-left of map/graph area, right of control panel
- **Preserve existing sidebar controls** for each view (embedded via iframes)
- **No split-screen view** - only one view visible at a time
- **No top banner** - control panels start at very top of page

### 2. Toggle Mechanism ✅
- Simple buttons labeled "Graph" and "Map"
- **No keyboard shortcuts** - just button clicks
- **Visual feedback**: Selected button has white background with black text (matching mode toggle buttons)
- **Instant transitions** between views
- **URL reflection**: `localhost:3060/?view=map` or `localhost:3060/?view=network`

### 3. State Preservation ✅
- **Automatic state preservation** via iframe embedding
- Each iframe maintains its own state independently
- Timeline position, selected user, degree filters, zoom/pan positions all preserved
- **No additional implementation needed** - handled by original bedrocks

### 4. Data Handling ✅
- **Separate data processing** maintained in original bedrocks
- Each iframe loads `data/comprehensive_data.json` independently
- **No data pipeline conflicts** - each view processes data as designed
- **Automatic refresh** when data changes

### 5. URL Structure ✅
- URL reflection implemented: `?view=map` or `?view=network`
- Browser back/forward navigation supported
- Direct URL access to specific views

### 6. Technical Implementation ✅
- **Single port (3060)** serving `unified_bedrock.html`
- **Original bedrocks preserved** and untouched on ports 3049 and 3050
- **Fallback capability** maintained - original files remain functional
- **Iframe embedding** for maximum robustness

### 7. Performance ✅
- **Instant transitions** between views
- **Efficient loading** - iframes load once and persist
- **No code duplication** - minimal memory footprint
- **Scalable architecture** - easy to add more views

## UI/UX Refinements ✅

### Button Styling
- **Active state**: White background (`var(--fg-primary)`) with black text (`var(--bg-primary)`)
- **Inactive state**: Default styling matching other control buttons
- **Positioning**: Top-left of visualization area, right of control panel with padding

### Layout
- **No top banner** or "ARC Social Network" header
- **Control panels** start at very top of page
- **Toggle buttons** positioned at same height as "Fit to Data" button
- **Clean, minimal interface** focused on functionality

### Header Synchronization ✅
- **Unified header styling** between 8th and 10th bedrocks
- **"arc" text**: Same font family, size (3rem), weight (700), and positioning
- **Header height**: Synchronized with adjusted bottom padding
- **Background color**: Pure black (#000000) with matching box-shadow
- **Separating line**: Subtle horizontal line below "arc" text in both bedrocks
- **Content**: Only "arc" text displayed (user/connection stats removed)
- **Visual consistency**: Headers now appear identical across both views

### Control Panel Scaling ✅
- **10th bedrock sidebar**: Scaled to 380px width to match 8th bedrock
- **Proportional scaling**: All elements scale using CSS custom properties
- **Consistent spacing**: Unified padding and margins across both interfaces
- **Maintained functionality**: All controls and interactions preserved

## Success Criteria ✅
- ✅ Users can seamlessly switch between Map and Network views
- ✅ All existing functionality preserved in both views
- ✅ Original bedrocks remain untouched and functional
- ✅ Clean, intuitive interface with proper visual feedback
- ✅ Automatic updates from original bedrocks
- ✅ Robust, maintainable architecture

## File Structure
```
/Users/lukeblanton/Documents/arc_unified_graph_map/
├── unified_bedrock.html          # Unified interface (port 3060)
├── 8th_bedrock_map.html          # Original map (port 3049)
├── 10th_bedrock_network.html     # Original network (port 3050)
├── data/comprehensive_data.json  # Shared data source
└── UnifiedBedrockSpecs.md        # This documentation
```

## Development Workflow
1. **Edit original bedrocks** (`8th_bedrock_map.html` or `10th_bedrock_network.html`)
2. **Changes automatically appear** in unified interface
3. **No need to modify** `unified_bedrock.html` for feature updates
4. **Fallback testing** always available on original ports

## Benefits of Iframe Approach
- **Maximum robustness**: No code integration issues
- **Automatic synchronization**: Changes to originals immediately visible
- **Independent development**: Each bedrock can be developed separately
- **Zero maintenance overhead**: No duplicate code to keep in sync
- **Future-proof**: Easy to add more visualizations
