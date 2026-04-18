/**
 * PM2 Ecosystem Configuration for SEER Trading Platform
 *
 * Phase 16: Enhanced with production-grade process supervision:
 * - Exponential backoff on restarts (prevents crash loops)
 * - Memory limit enforcement at 1.5GB (triggers before OOM)
 * - --expose-gc flag for MemoryMonitor remediation
 * - Reduced max_restarts from 50 to 10 (crash loop = real problem, not retry)
 * - JSON structured logging for ELK/Datadog ingestion
 *
 * Installation: npm install -g pm2
 * Start: pm2 start ecosystem.config.cjs
 * Monitor: pm2 monit
 * Logs: pm2 logs seer
 * Restart: pm2 restart seer
 * Stop: pm2 stop seer
 *
 * Production setup:
 *   pm2 startup          # Generate startup script for system boot
 *   pm2 save             # Save current process list
 *   pm2 install pm2-logrotate  # Install log rotation
 *   pm2 set pm2-logrotate:max_size 50M
 *   pm2 set pm2-logrotate:retain 10
 */

module.exports = {
  apps: [
    {
      name: 'seer',
      script: 'node_modules/.bin/tsx',
      args: 'server/_core/index.ts',
      cwd: '/home/ubuntu/seer',

      // Environment variables
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      env_development: {
        NODE_ENV: 'development',
        PORT: 3001,
      },

      // Process management
      instances: 1,                    // Single instance (trading system must be singleton for state)
      exec_mode: 'fork',               // Fork mode (not cluster — WebSocket + position state is per-process)

      // Auto-restart configuration
      autorestart: true,               // Automatically restart on crash
      watch: false,                    // Don't watch files in production
      max_restarts: 10,                // Phase 16: Reduced from 50 — 10 crashes = real problem, escalate
      min_uptime: '30s',               // Min uptime to consider "started"
      restart_delay: 5000,             // Wait 5s between restarts
      exp_backoff_restart_delay: 1000, // Phase 16: Exponential backoff starting at 1s (1, 2, 4, 8, 16s...)

      // Memory management — Phase 16: Tightened from 2GB to 1.5GB
      // MemoryMonitor takes remedial action at 80% (1.2GB), PM2 restarts at 1.5GB as last resort
      max_memory_restart: '1500M',
      node_args: '--max-old-space-size=1536 --expose-gc',

      // Logging — Phase 16: JSON structured for ELK/Datadog
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      error_file: '/home/ubuntu/seer/logs/seer-error.log',
      out_file: '/home/ubuntu/seer/logs/seer-out.log',
      merge_logs: true,
      log_type: 'json',

      // Graceful shutdown — Phase 16: Reduced from 30s to 15s
      // PositionGuardian emergency exit runs in <5s, 15s is generous
      kill_timeout: 15000,
      listen_timeout: 30000,           // 30s for startup (DB connections + agent init)

      // Source maps for better error stack traces
      source_map_support: true,
    },
  ],

  // Deployment configuration
  deploy: {
    production: {
      user: 'ubuntu',
      host: 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:user/seer.git',
      path: '/home/ubuntu/seer',
      'pre-deploy-local': '',
      'post-deploy': 'pnpm install && pm2 reload ecosystem.config.cjs --env production',
      'pre-setup': '',
    },
  },
};
