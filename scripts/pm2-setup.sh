#!/bin/bash
# PM2 Setup Script for SEER Trading Platform
# 
# This script sets up PM2 for production deployment with automatic restart on crash
# and system boot startup.
#
# Usage: ./scripts/pm2-setup.sh

set -e

echo "=========================================="
echo "SEER Trading Platform - PM2 Setup"
echo "=========================================="

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2 globally..."
    npm install -g pm2
fi

# Create logs directory
mkdir -p /home/ubuntu/seer/logs

# Stop any existing SEER process
echo "Stopping any existing SEER processes..."
pm2 stop seer 2>/dev/null || true
pm2 delete seer 2>/dev/null || true

# Start SEER with PM2
echo "Starting SEER with PM2..."
cd /home/ubuntu/seer
pm2 start ecosystem.config.cjs

# Wait for startup
echo "Waiting for startup..."
sleep 5

# Check status
echo "Checking status..."
pm2 status

# Setup startup script (run on system boot)
echo ""
echo "Setting up system startup..."
pm2 startup

# Save current process list
echo "Saving process list..."
pm2 save

echo ""
echo "=========================================="
echo "PM2 Setup Complete!"
echo "=========================================="
echo ""
echo "Useful commands:"
echo "  pm2 status        - Check process status"
echo "  pm2 logs seer     - View logs"
echo "  pm2 monit         - Real-time monitoring"
echo "  pm2 restart seer  - Restart the application"
echo "  pm2 stop seer     - Stop the application"
echo ""
echo "The SEER trading platform will now:"
echo "  ✓ Automatically restart on crash"
echo "  ✓ Restart on system reboot"
echo "  ✓ Restart if memory exceeds 2GB"
echo ""
