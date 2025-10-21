<!-- b0a85215-1fd9-445f-9cc4-15ed435ad2fe 992a5820-7be7-4927-8fa8-30b38109e326 -->
# Custom Freehand Drawing Tool Implementation

## Current State Analysis

### Existing Drawing Tool Setup

**File**: `8th_bedrock_map_user.html`

**Current Libraries**:

- Leaflet 1.9.4 (core mapping)
- Leaflet.draw 1.0.4 (original drawing plugin, partially replaced)
- Leaflet-Geoman free version (current drawing implementation)

**Current Implementation** (lines ~4090-4170):

- **Pencil button** in `.drawing-control-floating` container (line ~4075)
- **toggleDrawingMode()** function that enables/disables Geoman's 'Polygon' mode
- **drawnItems** FeatureGroup to manage drawn layers
- **Event handlers**: `pm:create`, `pm:edit`, `pm:remove`, `pm:dragstart`, `pm:drag`, `pm:dragend`
- **getVisibleTapsInShape()** function for point-in-polygon detection (line ~4200)
- **Mobile long-press** functionality with `createShapeAtLocation()` (line ~4397)
- **Results dropdown** system reusing community page styling

**Current Issues**:

- Polygon mode requires clicking points (not true freehand)
- 'Freehand' mode doesn't exist in Geoman free version
- User wants pencil-style drawing experience

**Working Features to Preserve**:

- ✅ Pencil button toggle with active state
- ✅ Click outside to clear shape but stay in draw mode
- ✅ Results dropdown showing taps in shape
- ✅ Filter integration (degree, timeline, user mode)
- ✅ Only shows currently visible taps
- ✅ Edit handles for moving/reshaping
- ✅ Debounced updates during drag
- ✅ Mobile responsive sizing
- ✅ Custom edit handle styling (transparent center, blue outer)

---

## Desired Functionality

### Desktop Experience

1. Click pencil button → Crosshairs mode active
2. Click and drag on map → Draw freehand shape in real-time (pencil effect)
3. Release mouse → Shape completes and closes automatically
4. Results dropdown appears showing taps within shape
5. Can drag inside shape to reposition
6. Can drag edges to resize/reshape
7. Click outside shape → Shape disappears, crosshairs stay active
8. Can immediately draw another shape
9. Click pencil button again → Exit draw mode

### Mobile Experience

1. Click pencil button → Enter draw mode
2. Touch and drag on map → Draw freehand shape with finger
3. Release touch → Shape completes automatically
4. Results dropdown appears
5. Can drag shape to reposition
6. Can use handles to resize
7. Tap outside shape → Shape disappears, draw mode stays active
8. Can immediately draw another shape
9. Click pencil button again → Exit draw mode

### Key Requirements

- **True freehand drawing**: Mouse/touch drag creates smooth custom shapes
- **Real-time preview**: See the line as you draw
- **Automatic closing**: Shape closes itself when released
- **Point simplification**: Reduce points for smooth shapes and performance
- **Edit functionality**: Use Geoman's existing edit handles (move/reshape)
- **Same UX flow**: All current behaviors preserved
- **Mobile optimized**: Touch-friendly drawing and editing

---

## Implementation Plan

### Phase 1: Custom Drawing Core (6-8 hours)

#### 1.1 Add Drawing State Variables

**Location**: `8th_bedrock_map_user.html` line ~4050 (with other drawing variables)

```javascript
// Custom freehand drawing state
let isDrawing = false;
let drawingPoints = [];
let temporaryPolyline = null;
const POINT_SIMPLIFICATION_TOLERANCE = 10; // meters
const MIN_POINTS_FOR_POLYGON = 3;
```

#### 1.2 Create Mouse Event Handlers

**Location**: After `toggleDrawingMode()` function (line ~4090)

```javascript
/**
 * Start freehand drawing on mouse down
 */
function startFreehandDrawing(e) {
    if (!isCrosshairsMode || !e.latlng) return;
    
    isDrawing = true;
    drawingPoints = [e.latlng];
    
    // Disable map dragging while drawing
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    
    console.log('Started drawing at:', e.latlng);
}

/**
 * Continue drawing as mouse moves
 */
function continueFreehandDrawing(e) {
    if (!isDrawing || !e.latlng) return;
    
    drawingPoints.push(e.latlng);
    updateTemporaryPath();
}

/**
 * Finish drawing on mouse up
 */
function finishFreehandDrawing(e) {
    if (!isDrawing) return;
    
    isDrawing = false;
    
    // Re-enable map interactions
    map.dragging.enable();
    map.scrollWheelZoom.enable();
    
    // Remove temporary preview
    if (temporaryPolyline) {
        map.removeLayer(temporaryPolyline);
        temporaryPolyline = null;
    }
    
    // Create polygon from points
    if (drawingPoints.length >= MIN_POINTS_FOR_POLYGON) {
        createPolygonFromPoints(drawingPoints);
    }
    
    drawingPoints = [];
    console.log('Finished drawing');
}

/**
 * Show real-time preview of drawing path
 */
function updateTemporaryPath() {
    // Remove existing preview
    if (temporaryPolyline) {
        map.removeLayer(temporaryPolyline);
    }
    
    // Create new preview polyline
    temporaryPolyline = L.polyline(drawingPoints, {
        color: '#007bff',
        weight: 2,
        opacity: 0.7,
        interactive: false
    }).addTo(map);
}

/**
 * Simplify points using distance-based algorithm
 */
function simplifyPoints(points, tolerance = POINT_SIMPLIFICATION_TOLERANCE) {
    if (points.length <= MIN_POINTS_FOR_POLYGON) return points;
    
    const simplified = [points[0]]; // Always keep first point
    
    for (let i = 1; i < points.length - 1; i++) {
        const prevPoint = simplified[simplified.length - 1];
        const distance = map.distance(prevPoint, points[i]);
        
        if (distance > tolerance) {
            simplified.push(points[i]);
        }
    }
    
    // Always keep last point
    simplified.push(points[points.length - 1]);
    
    console.log(`Simplified ${points.length} points to ${simplified.length} points`);
    return simplified;
}

/**
 * Create polygon from drawn points and enable editing
 */
function createPolygonFromPoints(points) {
    // Simplify points for smoother shape
    const simplified = simplifyPoints(points);
    
    if (simplified.length < MIN_POINTS_FOR_POLYGON) {
        console.log('Not enough points for polygon');
        return;
    }
    
    // Clear any existing shapes
    drawnItems.clearLayers();
    closeCircleResults();
    
    // Create polygon with styling
    const polygon = L.polygon(simplified, {
        color: '#007bff',
        fillColor: '#007bff',
        fillOpacity: 0.1,
        weight: 2
    });
    
    // Add to map
    drawnItems.addLayer(polygon);
    
    // Enable Geoman editing
    polygon.pm.enable({
        allowSelfIntersection: false,
        preventMarkerRemoval: true
    });
    
    // Get taps in shape and show results
    const tapsInShape = getVisibleTapsInShape(polygon);
    showCircleResults(tapsInShape, polygon);
    
    console.log('Created polygon with', simplified.length, 'points');
}
```

#### 1.3 Add Touch Event Handlers

**Location**: After mouse event handlers

```javascript
/**
 * Handle touch start for mobile drawing
 */
function handleTouchStart(e) {
    if (!isCrosshairsMode) return;
    
    const touch = e.originalEvent.touches[0];
    const latlng = map.containerPointToLatLng([touch.clientX, touch.clientY]);
    
    startFreehandDrawing({ latlng });
}

/**
 * Handle touch move for mobile drawing
 */
function handleTouchMove(e) {
    if (!isDrawing) return;
    
    e.originalEvent.preventDefault(); // Prevent scrolling
    
    const touch = e.originalEvent.touches[0];
    const latlng = map.containerPointToLatLng([touch.clientX, touch.clientY]);
    
    continueFreehandDrawing({ latlng });
}

/**
 * Handle touch end for mobile drawing
 */
function handleTouchEnd(e) {
    if (!isDrawing) return;
    
    finishFreehandDrawing({ latlng: null });
}
```

#### 1.4 Update toggleDrawingMode()

**Location**: Replace existing function (line ~4090)

```javascript
function toggleDrawingMode() {
    const drawToggleBtn = document.getElementById('drawToggleBtn');
    
    if (isCrosshairsMode) {
        // Disable drawing mode
        console.log('Disabling draw mode');
        isCrosshairsMode = false;
        drawToggleBtn.classList.remove('active');
        
        // Remove event listeners
        map.off('mousedown', startFreehandDrawing);
        map.off('mousemove', continueFreehandDrawing);
        map.off('mouseup', finishFreehandDrawing);
        map.off('touchstart', handleTouchStart);
        map.off('touchmove', handleTouchMove);
        map.off('touchend', handleTouchEnd);
        
        // Disable Geoman draw mode (in case it was active)
        map.pm.disableDraw();
        closeCircleResults();
        
        // Re-enable tap marker interactions
        markers.forEach(marker => {
            if (marker._tapData) {
                marker.options.interactive = true;
            }
        });
    } else {
        // Enable drawing mode
        console.log('Enabling freehand draw mode');
        isCrosshairsMode = true;
        drawToggleBtn.classList.add('active');
        
        // Disable tap marker interactions during drawing
        markers.forEach(marker => {
            if (marker._tapData) {
                marker.options.interactive = false;
            }
        });
        
        // Add event listeners for custom drawing
        map.on('mousedown', startFreehandDrawing);
        map.on('mousemove', continueFreehandDrawing);
        map.on('mouseup', finishFreehandDrawing);
        map.on('touchstart', handleTouchStart);
        map.on('touchmove', handleTouchMove);
        map.on('touchend', handleTouchEnd);
        
        console.log('Freehand drawing enabled with custom handlers');
    }
}
```

---

### Phase 2: Geoman Integration for Editing (2-3 hours)

#### 2.1 Keep Geoman Initialization (Editing Only)

**Location**: `initDrawingTools()` function (line ~4000)

**Keep this code but update comments**:

```javascript
function initDrawingTools() {
    // Initialize drawn items layer
    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    
    // Initialize Geoman (for editing only, not drawing)
    map.pm.addControls({
        position: 'topleft',
        drawMarker: false,
        drawCircleMarker: false,
        drawPolyline: false,
        drawRectangle: false,
        drawPolygon: false,  // Custom drawing instead
        drawCircle: false,
        editMode: true,
        dragMode: true,
        cutPolygon: false,
        removalMode: true
    });
    
    // Hide Geoman toolbar (we use custom pencil button)
    setTimeout(() => {
        const geomanToolbar = document.querySelector('.leaflet-pm-toolbar');
        if (geomanToolbar) {
            geomanToolbar.style.display = 'none';
            console.log('Geoman toolbar hidden (used for editing only)');
        }
    }, 100);
    
    // Keep existing Geoman event listeners for editing
    map.on('pm:edit', function(e) { /* existing code */ });
    map.on('pm:remove', function(e) { /* existing code */ });
    map.on('pm:dragstart', function(e) { /* existing code */ });
    map.on('pm:drag', function(e) { /* existing code */ });
    map.on('pm:dragend', function(e) { /* existing code */ });
    
    // Initialize custom drawing button
    initDrawingButton();
}
```

#### 2.2 Update Event Handlers

**Keep existing Geoman edit/drag/remove handlers** - they work with custom-drawn polygons

**Remove**: `pm:create` handler (we create polygons manually now)

---

### Phase 3: Click-Outside Behavior (1 hour)

#### 3.1 Update Map Click Handler

**Location**: In `addCustomMapEventHandlers()` or after drawing functions

```javascript
/**
 * Handle clicks on map (outside shapes)
 */
map.on('click', function(e) {
    if (!isCrosshairsMode) return;
    
    // Check if click was on a drawn shape
    const clickedOnShape = isClickOnShape(e.latlng);
    
    if (!clickedOnShape) {
        // Clear existing shape but stay in draw mode
        clearExistingShapeAndResetDrawMode();
    }
});

/**
 * Check if click was on a drawn shape
 */
function isClickOnShape(latlng) {
    let clickedShape = false;
    
    drawnItems.eachLayer(layer => {
        if (layer instanceof L.Polygon) {
            // Use point-in-polygon detection
            if (isPointInPolygon(latlng, layer)) {
                clickedShape = true;
            }
        }
    });
    
    return clickedShape;
}

/**
 * Clear shape and stay in draw mode
 */
function clearExistingShapeAndResetDrawMode() {
    if (drawnItems && drawnItems.getLayers().length > 0) {
        drawnItems.clearLayers();
        closeCircleResults();
        console.log('Cleared shape, ready to draw again');
    }
}
```

---

### Phase 4: Mobile Optimizations (2-3 hours)

#### 4.1 Remove Old Mobile Long-Press Logic

**Location**: Remove `createShapeAtLocation()` and related long-press timers

Mobile now uses the same freehand drawing as desktop via touch events.

#### 4.2 Add Touch-Specific Optimizations

```javascript
/**
 * Optimize point collection for touch devices
 */
function shouldAddPoint(newPoint, lastPoint) {
    if (!lastPoint) return true;
    
    // On mobile, add points less frequently for smoother shapes
    const minDistance = isMobileDevice() ? 15 : 5; // meters
    const distance = map.distance(lastPoint, newPoint);
    
    return distance > minDistance;
}

/**
 * Update continueFreehandDrawing with optimization
 */
function continueFreehandDrawing(e) {
    if (!isDrawing || !e.latlng) return;
    
    const lastPoint = drawingPoints[drawingPoints.length - 1];
    if (shouldAddPoint(e.latlng, lastPoint)) {
        drawingPoints.push(e.latlng);
        
        // Throttle preview updates on mobile for performance
        if (!isMobileDevice() || drawingPoints.length % 3 === 0) {
            updateTemporaryPath();
        }
    }
}
```

#### 4.3 Add Touch Gesture Prevention

```javascript
/**
 * Prevent default touch behaviors during drawing
 */
function preventTouchDefaults(e) {
    if (isDrawing) {
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
    }
}

// Add to event listeners
map.on('touchmove', preventTouchDefaults);
```

---

### Phase 5: Testing & Polish (2-3 hours)

#### 5.1 Add Error Handling

```javascript
/**
 * Enhanced createPolygonFromPoints with error handling
 */
function createPolygonFromPoints(points) {
    try {
        const simplified = simplifyPoints(points);
        
        if (simplified.length < MIN_POINTS_FOR_POLYGON) {
            console.warn('Not enough points for polygon:', simplified.length);
            return;
        }
        
        // Clear existing
        drawnItems.clearLayers();
        closeCircleResults();
        
        // Create polygon
        const polygon = L.polygon(simplified, {
            color: '#007bff',
            fillColor: '#007bff',
            fillOpacity: 0.1,
            weight: 2
        });
        
        drawnItems.addLayer(polygon);
        polygon.pm.enable({ allowSelfIntersection: false });
        
        const tapsInShape = getVisibleTapsInShape(polygon);
        showCircleResults(tapsInShape, polygon);
        
    } catch (error) {
        console.error('Error creating polygon:', error);
        // Clean up on error
        if (temporaryPolyline) {
            map.removeLayer(temporaryPolyline);
            temporaryPolyline = null;
        }
    }
}
```

#### 5.2 Add Visual Feedback

**CSS for drawing cursor**:

```css
/* Crosshairs cursor during drawing mode */
.leaflet-container.drawing-mode {
    cursor: crosshair !important;
}

.leaflet-container.drawing-mode.drawing-active {
    cursor: crosshair !important;
}
```

**JavaScript to apply**:

```javascript
function toggleDrawingMode() {
    const mapContainer = document.getElementById('map');
    
    if (isCrosshairsMode) {
        // Disable
        mapContainer.classList.remove('drawing-mode');
        // ... rest of disable code
    } else {
        // Enable
        mapContainer.classList.add('drawing-mode');
        // ... rest of enable code
    }
}

function startFreehandDrawing(e) {
    // ... existing code
    document.getElementById('map').classList.add('drawing-active');
}

function finishFreehandDrawing(e) {
    // ... existing code
    document.getElementById('map').classList.remove('drawing-active');
}
```

#### 5.3 Performance Optimization

```javascript
/**
 * Throttle preview updates for better performance
 */
let lastPreviewUpdate = 0;
const PREVIEW_THROTTLE_MS = 16; // ~60fps

function updateTemporaryPath() {
    const now = Date.now();
    if (now - lastPreviewUpdate < PREVIEW_THROTTLE_MS) {
        return; // Skip this update
    }
    lastPreviewUpdate = now;
    
    // Remove existing preview
    if (temporaryPolyline) {
        map.removeLayer(temporaryPolyline);
    }
    
    // Only show preview if we have enough points
    if (drawingPoints.length >= 2) {
        temporaryPolyline = L.polyline(drawingPoints, {
            color: '#007bff',
            weight: 2,
            opacity: 0.7,
            interactive: false
        }).addTo(map);
    }
}
```

---

## Files Modified

**Primary File**: `8th_bedrock_map_user.html`

**Sections Modified**:

1. Lines ~4050: Add drawing state variables
2. Lines ~4090: Replace `toggleDrawingMode()` function
3. Lines ~4150: Add custom drawing functions (8 new functions)
4. Lines ~4000: Update `initDrawingTools()` comments
5. Lines ~4300: Update click handler
6. Lines ~4397: Remove old mobile long-press logic
7. Add CSS for drawing cursor (~line 250)

**Functions Added** (10 new functions):

- `startFreehandDrawing()`
- `continueFreehandDrawing()`
- `finishFreehandDrawing()`
- `updateTemporaryPath()`
- `simplifyPoints()`
- `createPolygonFromPoints()`
- `handleTouchStart()`
- `handleTouchMove()`
- `handleTouchEnd()`
- `shouldAddPoint()`

**Functions Modified** (3 functions):

- `toggleDrawingMode()` - Replace Geoman calls with custom event listeners
- `initDrawingTools()` - Update comments to clarify Geoman is for editing only
- `clearExistingShapeAndResetDrawMode()` - Already exists, works as-is

**Functions Removed** (1 function):

- `createShapeAtLocation()` - No longer needed (old mobile long-press)

**Geoman Usage**:

- Keep for editing only (`polygon.pm.enable()`)
- Keep event handlers: `pm:edit`, `pm:remove`, `pm:drag*`
- Remove: `pm:create` handler
- Keep: Toolbar hiding, global options

---

## Testing Checklist

### Desktop Testing

- [ ] Click pencil button activates draw mode
- [ ] Cursor changes to crosshairs
- [ ] Click and drag draws smooth line preview
- [ ] Release creates closed polygon
- [ ] Results dropdown appears with correct taps
- [ ] Can drag inside polygon to reposition
- [ ] Can drag edges to reshape
- [ ] Click outside clears polygon but stays in draw mode
- [ ] Can draw multiple polygons sequentially
- [ ] Pencil button toggles off draw mode

### Mobile Testing

- [ ] Pencil button activates on mobile
- [ ] Touch and drag draws shape
- [ ] Release creates polygon
- [ ] Results dropdown appears
- [ ] Can drag to reposition
- [ ] Can use handles to reshape
- [ ] Tap outside clears shape
- [ ] No accidental map panning during draw
- [ ] Performance is smooth (60fps)

### Filter Integration

- [ ] Only shows currently visible taps
- [ ] Respects degree filters
- [ ] Respects timeline slider
- [ ] Respects cumulative mode
- [ ] Updates when filters change

### Edge Cases

- [ ] Very small shapes (< 3 points)
- [ ] Very large shapes (> 100 points)
- [ ] Fast drawing (stress test)
- [ ] Slow drawing
- [ ] Drawing across map bounds
- [ ] Drawing at various zoom levels
- [ ] Multiple rapid draw/clear cycles

---

## Expected Behavior

### Drawing Flow

1. **Pencil clicked** → Crosshairs mode, event listeners added
2. **Mouse/touch down** → Drawing starts, map dragging disabled
3. **Mouse/touch move** → Points collected, preview updates in real-time
4. **Mouse/touch up** → Drawing stops, points simplified, polygon created
5. **Polygon created** → Geoman editing enabled, results shown
6. **Edit handles appear** → Can move/reshape polygon
7. **Click outside** → Polygon cleared, ready to draw again
8. **Pencil clicked** → Draw mode exits, event listeners removed

### Performance Targets

- **Desktop**: 60fps during drawing
- **Mobile**: 30-60fps during drawing
- **Point simplification**: Reduce to 10-30% of original points
- **Preview throttle**: Update every 16ms max (60fps)
- **Polygon creation**: < 100ms from release to display

### UX Goals

- **Smooth drawing**: No lag or jitter
- **Intuitive**: Works like any drawing app
- **Responsive**: Immediate visual feedback
- **Consistent**: Same behavior desktop and mobile
- **Professional**: Polished with proper cursors and states

### To-dos

- [ ] Implement custom freehand drawing core (state variables, mouse/touch handlers, point simplification, polygon creation)
- [ ] Integrate Geoman for editing functionality (keep edit handlers, update initialization)
- [ ] Implement click-outside behavior (clear shape but stay in draw mode)
- [ ] Add mobile-specific optimizations (touch handling, performance throttling, gesture prevention)
- [ ] Add error handling, visual feedback, performance optimizations, and complete testing