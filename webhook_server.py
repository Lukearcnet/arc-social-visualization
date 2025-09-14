#!/usr/bin/env python3
"""
Local webhook server for Vercel cron job data refresh.
This runs on your local machine and handles the actual data refresh.
"""

import os
import sys
import json
import subprocess
import hashlib
import hmac
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Configuration
WEBHOOK_SECRET = "qVq+BFklhT6QKZaUkM4t9ofQEtzPt1W2Ys/WMDAiTag="  # Same as Vercel
PORT = 8081

class WebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        """Handle POST requests from Vercel cron job."""
        print(f"📨 Received POST request to: {self.path}")
        try:
            # Get the request body
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                post_data = self.rfile.read(content_length)
            
            # Verify the webhook secret
            auth_header = self.headers.get('X-Webhook-Secret', '')
            if auth_header != WEBHOOK_SECRET:
                print(f"❌ Unauthorized request. Expected: {WEBHOOK_SECRET}, Got: {auth_header}")
                self.send_response(401)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'unauthorized'}).encode())
                return
            
            print("🔄 Webhook triggered: Starting data refresh...")
            
            # Run the data refresh process
            result = self.run_data_refresh()
            
            # Send success response
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
            
        except Exception as e:
            print(f"❌ Webhook error: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
    
    def do_GET(self):
        """Handle GET requests for health checks."""
        print(f"📨 Received GET request to: {self.path}")
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'status': 'ok', 'message': 'Webhook server is running'}).encode())
    
    def run_data_refresh(self):
        """Run the actual data refresh process."""
        try:
            # Step 1: Run the data export script
            print("📊 Running data export script...")
            force_direct_graph_path = "/Users/lukeblanton/Documents/Force Direct Graph"
            python_script = os.path.join(force_direct_graph_path, "src/SQL-based/data_export_for_visualizations.py")
            
            result = subprocess.run(
                ["python3", python_script],
                cwd=force_direct_graph_path,
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )
            
            if result.returncode != 0:
                raise Exception(f"Data export failed: {result.stderr}")
            
            print("✅ Data export completed")
            
            # Step 2: Copy files to Git repo
            print("📁 Copying files to Git repo...")
            source_file = os.path.join(force_direct_graph_path, "output/SQL-based/data/comprehensive_data.json")
            dest_file = "/Users/lukeblanton/Documents/arc_unified_graph_map/data/comprehensive_data.json"
            
            subprocess.run(["cp", source_file, dest_file], check=True)
            print("✅ Files copied to Git repo")
            
            # Step 3: Git operations
            print("🔄 Committing to Git...")
            git_repo = "/Users/lukeblanton/Documents/arc_unified_graph_map"
            
            # Change to the git repository directory
            os.chdir(git_repo)
            
            # Check current branch and switch to develop
            result = subprocess.run(["git", "branch", "--show-current"], capture_output=True, text=True, check=True)
            current_branch = result.stdout.strip()
            print(f"📋 Current branch: {current_branch}")
            
            # Switch to develop branch
            subprocess.run(["git", "checkout", "develop"], check=True)
            subprocess.run(["git", "pull", "origin", "develop"], check=True)
            
            # Add and commit
            subprocess.run(["git", "add", "data/comprehensive_data.json"], check=True)
            subprocess.run(["git", "commit", "-m", f"data: refresh {subprocess.run(['date'], capture_output=True, text=True).stdout.strip()}"], check=True)
            subprocess.run(["git", "push", "origin", "develop"], check=True)
            
            # Merge to main
            subprocess.run(["git", "checkout", "main"], check=True)
            subprocess.run(["git", "pull", "origin", "main"], check=True)
            subprocess.run(["git", "merge", "develop"], check=True)
            subprocess.run(["git", "push", "origin", "main"], check=True)
            
            print("✅ Data refresh complete!")
            
            return {
                "success": True,
                "message": "Data refresh completed successfully",
                "timestamp": subprocess.run(["date"], capture_output=True, text=True).stdout.strip()
            }
            
        except Exception as e:
            print(f"❌ Data refresh failed: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def log_message(self, format, *args):
        """Override to prevent default logging."""
        pass

if __name__ == "__main__":
    print(f"🚀 Starting webhook server on port {PORT}")
    print(f"🔑 Webhook secret: {WEBHOOK_SECRET}")
    print("📡 Waiting for Vercel cron job triggers...")
    
    server = HTTPServer(('localhost', PORT), WebhookHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Webhook server stopped")
        server.shutdown()
