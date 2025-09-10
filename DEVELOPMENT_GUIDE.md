# Development Workflow Guide

## Project Structure

### Branches
- **main**: Production code (live at https://arc-social-visualization.vercel.app)
- **develop**: Development code (preview at https://arc-social-visualization-git-develop.vercel.app)
- **feature/***: Feature branches for new development

### Deployment
- **Production**: Automatically deploys from `main` branch
- **Preview**: Automatically deploys from `develop` and feature branches
- **Squarespace Integration**: Production URL embedded at https://www.arcsocial.app/visualization

## Development Workflow

### 1. Daily Development
```bash
# Start working
git checkout develop
git pull origin develop

# Make your changes
# ... edit files ...

# Test locally (optional)
python3 -m http.server 8000

# Commit and push
git add .
git commit -m "feat: describe your changes"
git push origin develop
```

### 2. New Features
```bash
# Create feature branch
git checkout develop
git pull origin develop
git checkout -b feat/your-feature-name

# Make changes
# ... develop your feature ...

# Push and test
git push -u origin feat/your-feature-name
# Test on Vercel preview URL

# When ready, merge to develop
# (Create PR: feat/* → develop)
```

### 3. Production Deployment
```bash
# When develop is stable, merge to main
git checkout main
git pull origin main
git merge develop
git push origin main
# Production automatically deploys
```

## Testing

### Local Testing
- Use `python3 -m http.server 8000` in project root
- Test at `http://localhost:8000/unified_bedrock_user.html`

### Preview Testing
- Every push to `develop` creates a Vercel preview
- Test at: https://arc-social-visualization-git-develop.vercel.app
- Test Squarespace integration before merging to main

### Production Testing
- Test at: https://arc-social-visualization.vercel.app
- Test Squarespace integration at: https://www.arcsocial.app/visualization

## Data Updates

### Refresh Data
```bash
# Run data export (from Force Direct Graph project)
cd "/Users/lukeblanton/Documents/Force Direct Graph"
python3 src/SQL-based/data_export_for_visualizations.py

# Copy to this project
cp "output/SQL-based/data/comprehensive_data.json" "/Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json"

# Commit and push
cd "/Users/lukeblanton/Documents/arc_unified_graph_map"
git add data/comprehensive_data.json
git commit -m "data: refresh visualization data"
git push origin develop
```

## File Structure

```
arc_unified_graph_map/
├── unified_bedrock_user.html    # Main entry point (ACTIVE)
├── 8th_bedrock_map_user.html    # Map visualization (ACTIVE)
├── 10th_bedrock_network_user.html # Network visualization (ACTIVE)
├── data/
│   └── comprehensive_data.json  # Visualization data (1037 taps, 280 users)
├── _headers                     # Netlify headers
├── vercel.json                  # Vercel configuration
├── _redirects                   # Netlify redirects
├── User Version/                # OLD BACKUP FILES (don't edit)
├── lib/                         # OLD BACKUP FILES (don't edit)
└── README.md                    # Project documentation
```

### Important Notes
- **ALWAYS edit root-level files** - `unified_bedrock_user.html`, `8th_bedrock_map_user.html`, `10th_bedrock_network_user.html`
- **NEVER edit subdirectory files** - `User Version/` and `lib/` contain old backups
- **All active development** happens in the root directory

## Important Notes

### Security
- **main branch is protected** - requires pull requests
- **Never push directly to main** - always use develop first
- **Test on preview URLs** before production deployment

### Squarespace Integration
- **CSP headers** allow embedding from https://www.arcsocial.app
- **Iframe code** for Squarespace:
```html
<iframe 
  src="https://arc-social-visualization.vercel.app" 
  width="100%" 
  height="800px" 
  frameborder="0"
  style="border: none; border-radius: 8px;"
  title="Arc Social Network Visualization">
</iframe>
```

### Troubleshooting
- **If preview doesn't deploy**: Check Vercel dashboard for build errors
- **If CSP blocks iframe**: Update `_headers` and `vercel.json` with new domains
- **If data is stale**: Run data refresh process above

## Quick Commands

```bash
# Start development
git checkout develop && git pull

# Create feature
git checkout -b feat/feature-name

# Deploy to production
git checkout main && git merge develop && git push

# Refresh data
cp "/Users/lukeblanton/Documents/Force Direct Graph/output/SQL-based/data/comprehensive_data.json" "./data/comprehensive_data.json"
```
