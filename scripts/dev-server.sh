#!/bin/bash

# Enterprise-Grade Development Server Launcher
# Handles resource limits, cleanup, and graceful shutdown

set -e

echo "🚀 Starting SEER Development Server..."

# Kill any existing processes on port 3000-3010
echo "🧹 Cleaning up existing processes..."
for port in {3000..3010}; do
  lsof -ti:$port | xargs kill -9 2>/dev/null || true
done

# Increase file descriptor limits
echo "📊 Setting resource limits..."
ulimit -n 65536
echo "   ✓ File descriptors: $(ulimit -n)"

# Set environment variables
export NODE_ENV=development
export NODE_OPTIONS="--max-old-space-size=4096"

# Clean up stale file watchers
echo "🗑️  Removing stale caches..."
rm -rf node_modules/.cache .next dist 2>/dev/null || true

# Function to cleanup on exit
cleanup() {
  echo ""
  echo "🛑 Shutting down gracefully..."
  
  # Kill child processes
  jobs -p | xargs kill -TERM 2>/dev/null || true
  
  # Wait for processes to exit
  sleep 2
  
  # Force kill if still running
  jobs -p | xargs kill -9 2>/dev/null || true
  
  echo "✅ Cleanup complete"
  exit 0
}

# Register cleanup handlers
trap cleanup SIGINT SIGTERM EXIT

# Start the server without watch mode to avoid file watcher exhaustion
echo "🌐 Starting server..."
cd "$(dirname "$0")/.."

# Run server with tsx (no watch mode)
NODE_ENV=development pnpm exec tsx server/_core/index.ts

# Keep script running
wait
