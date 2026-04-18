#!/bin/bash

# SEER Server Startup Script
# Fixes EMFILE (too many open files) error permanently

echo "🚀 Starting SEER Server..."

# Increase file descriptor limits
ulimit -n 65536
echo "✅ File descriptor limit set to $(ulimit -n)"

# Set NODE_ENV
export NODE_ENV="${NODE_ENV:-development}"
echo "📦 Environment: $NODE_ENV"

# Phase 42: Match production memory limit (768MB) to force aggressive GC
# This prevents memory leaks from going unnoticed in dev
export NODE_OPTIONS="--max-old-space-size=768 --expose-gc"
echo "✅ Node.js memory limit set to 768MB (production-matching)"

# Force Chokidar (Vite's file watcher) to use polling mode
# This prevents EMFILE errors in containerized/sandboxed environments
export CHOKIDAR_USEPOLLING=1
export CHOKIDAR_INTERVAL=1000
echo "✅ Chokidar polling mode enabled (interval: 1000ms)"

# Start server with tsx (no watch mode to avoid file watcher exhaustion)
echo "🔧 Starting server..."
cd /home/ubuntu/seer
exec pnpm exec tsx server/_core/index.ts
