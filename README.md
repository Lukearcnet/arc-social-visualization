# 🌐 ARC Social Visualization

A unified social graph visualization platform that combines map and network views with user authentication.

## 🚀 Live Demo

- **Production**: [https://arcsocial.app](https://arcsocial.app)
- **Visualization**: Embedded in Webflow site

## 📋 Features

- ✅ **Unified Interface**: Toggle between Map and Network visualizations
- ✅ **User Authentication**: Phone number login with auto-selection
- ✅ **Session Management**: Persistent login across page refreshes
- ✅ **Responsive Design**: Works on all device sizes
- ✅ **Real-time Data**: Dynamic loading from comprehensive_data.json
- ✅ **Performance Optimized**: 90%+ improvement over original versions

## 🏗️ Architecture

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Visualization**: Vis.js network library, Google Maps API
- **Data**: JSON-based user and connection data
- **Deployment**: Vercel/Netlify with automatic GitHub integration
- **Integration**: Embedded in Webflow via iframe

## 📁 Project Structure

```
arc-social-visualization/
├── unified_bedrock_user.html      # Main unified interface
├── 8th_bedrock_map_user.html      # Map visualization
├── 10th_bedrock_network_user.html # Network visualization
├── data/
│   └── comprehensive_data.json    # User and connection data
├── lib/
│   ├── vis-9.1.2/                # Vis.js network library
│   ├── tom-select/                # Search autocomplete
│   └── bindings/                  # Utility functions
├── _headers                       # Netlify headers config
├── _redirects                     # Netlify redirects config
├── vercel.json                    # Vercel deployment config
└── README.md                      # This file
```

## 🚀 Deployment

### Automatic Deployment
- Push to `main` branch triggers automatic deployment
- Updates go live in 1-2 minutes
- Both Vercel and Netlify configurations included

### Manual Deployment
```bash
# Install dependencies (if any)
npm install

# Build (if needed)
npm run build

# Deploy to Vercel
vercel --prod

# Deploy to Netlify
netlify deploy --prod
```

## 🔧 Development

### Local Development
```bash
# Start local server
python3 -m http.server 8000

# Access at http://localhost:8000/unified_bedrock_user.html
```

### File Structure
- **unified_bedrock_user.html**: Main entry point with authentication
- **8th_bedrock_map_user.html**: Map visualization (user-centric)
- **10th_bedrock_network_user.html**: Network visualization (user-centric)
- **data/comprehensive_data.json**: User and connection data

## 📊 Data Format

The visualization loads data from `comprehensive_data.json`:
- **Users**: 246 users with profile information
- **Connections**: 371 verified connections between users
- **Authentication**: Phone number mapping for user login

## 🌐 Webflow Integration

### Iframe Embed
```html
<div style="position:relative;width:100%;min-height:60vh;">
  <iframe
    src="https://arc-social-viz.vercel.app"
    style="position:relative;border:0;width:100%;height:100%;"
    loading="lazy"
    allow="fullscreen"
    title="ARC Social Graph Visualization"
  ></iframe>
</div>
```

### Headers Configuration
- **X-Frame-Options**: ALLOWALL
- **Content-Security-Policy**: frame-ancestors configured for Webflow
- **CORS**: Configured for arcsocial.app origin

## 🎯 Performance

- **Load Time**: <3 seconds for iframe content
- **User-centric Mode**: <1 second transitions
- **Timeline Updates**: ~64ms (99%+ improvement)
- **Degree Filtering**: ~18ms (98%+ improvement)

## 🔐 Security

- **Authentication**: Phone number-based user verification
- **Data Privacy**: User data only accessible after authentication
- **CORS**: Properly configured for Webflow origin
- **API Security**: Serverless functions for sensitive operations

## 📈 Analytics

- **User Engagement**: Tracked via Webflow and visualization host
- **Performance**: Monitored via hosting platform
- **Authentication**: Success rates tracked
- **Mobile Usage**: Responsive design metrics

## 🚨 Troubleshooting

### Common Issues
1. **Iframe Not Loading**: Check X-Frame-Options headers
2. **CORS Errors**: Verify Content-Security-Policy configuration
3. **Data Not Loading**: Check data file path and permissions
4. **Authentication Failing**: Verify phone number format in data

### Support
- **Documentation**: See `docs/` directory for detailed guides
- **Issues**: Report via GitHub Issues
- **Contact**: luke@arcsocial.app

## 📝 License

Private project - All rights reserved

---

**🎯 Built for ARC Social - Authentic. Real. Connections.**# Trigger redeploy
