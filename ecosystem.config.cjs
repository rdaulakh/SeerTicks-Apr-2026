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

      // Memory management — Phase 82 (was Phase 16: 1500M, too tight)
      // Observed working-set: server grows ~70 MiB/s during startup +
      // first signal cycle (candle backfill, agent init, BayesianAggregator
      // warmup) and lands somewhere around 2.5–4 GB before stabilising.
      // Previous 1500M ceiling triggered restart-loops every ~30s (368
      // restarts observed in production) which surfaced as 502 storms on
      // the frontend and "agents appear-then-vanish". 3GB still restarted
      // every ~45s. Bumped to 5GB to push restarts past startup phase.
      // Real fix (memory leak in init path) is Phase 83 follow-up.
      max_memory_restart: '5000M',
      node_args: '--max-old-space-size=5120 --expose-gc',

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
