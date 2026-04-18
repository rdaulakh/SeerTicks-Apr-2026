# SEER Trading Platform - Complete Repository

This repository contains the complete SEER autonomous trading platform with all source code, configuration, database schema, and trading engine implementation.

## Repository Contents

### Core Application
- **`client/`** - React 19 frontend with Tailwind CSS 4
- **`server/`** - Express 4 backend with tRPC 11 API
- **`drizzle/`** - Database schema and migrations
- **`server/services/`** - Trading engine services:
  - `AutomatedSignalProcessor.ts` - Signal generation and consensus
  - `EnhancedTradeExecutor.ts` - Trade execution and risk management
  - `PriorityExitManager.ts` - Exit strategy management
  - `IntelligentExitManager.ts` - Intelligent exit logic
  - `UserTradingSession.ts` - User trading session management
  - `Week9RiskManager.ts` - Risk management and position tracking
  - `MacroVetoEnforcer.ts` - Macro event risk protection

### AI Agents
- **`server/agents/`** - 14 AI trading agents:
  - Technical analysis agents (TechnicalAnalyst, PatternMatcher)
  - On-chain analysis (OnChainFlowAnalyst, LiquidationHeatmap)
  - Sentiment analysis (SentimentAnalyst, NewsSentinel)
  - Macro analysis (MacroAnalyst, VolumeProfileAnalyzer)
  - And 6 more specialized agents

### Configuration & Documentation
- **`server/config/TradingConfig.ts`** - Trading parameters and regime-adjusted exits
- **`ARCHITECTURE.md`** - System architecture overview
- **`ARCHITECTURAL_ASSESSMENT.md`** - Detailed architecture assessment
- **`.env.template`** - Environment variables template

### Database
- **`database_export.sql`** - Complete database schema and data export
- **`scripts/export-database.mjs`** - Script to export database

### Audit & Analysis
- **`SEER_COMPLETION_AUDIT.md`** - Completion audit
- **`VERIFICATION_RESULTS.json`** - Verification results
- **`todo.md`** - Project TODO list with Phase 45 bug fixes

## Quick Start

### Prerequisites
- Node.js 22.13.0+
- MySQL 8.0+
- npm or pnpm

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/rdaulakh/SeerTicks-Apr-2026.git
   cd SeerTicks-Apr-2026
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Setup environment variables**
   ```bash
   cp .env.template .env
   # Edit .env with your actual values
   ```

4. **Setup database**
   ```bash
   # Option A: Import the exported database
   mysql -h your_host -u your_user -p your_database < database_export.sql
   
   # Option B: Create fresh schema
   pnpm db:push
   ```

5. **Start the development server**
   ```bash
   pnpm dev
   ```

The application will be available at `http://localhost:3000`

## Key Features

### Autonomous Trading Engine
- **14 AI Agents** working in consensus to generate trading signals
- **Real-time Signal Processing** with regime-aware decision making
- **Intelligent Exit Management** with multiple exit strategies
- **Risk Management** with position limits and drawdown protection
- **Paper Trading Mode** for safe backtesting

### Trading Strategies
- **Consensus-based signals** - Multiple agents must agree before trading
- **Regime detection** - Adapts strategy based on market conditions (trending, ranging, volatile)
- **Dynamic exit management** - Exits adjusted based on market regime
- **Macro veto system** - Prevents trading during high-impact economic events
- **Position sizing** - Intelligent position sizing based on risk metrics

### Phase 45 Bug Fixes (March 13, 2026)
- Fixed SignalAggregator consensus calculation (was always 0%)
- Fixed UserTradingSession safety exits (widened from 15min to 45min)
- Fixed DIRECTION_FLIP exit losses (added dead zone protection)
- Fixed TradingConfig base exits (-1.2% stop, 25 min hold)
- Fixed FOMC veto false positives
- Fixed hold time calculation errors
- **Result: Win rate improved from 27.9% to 50%, first net positive P&L**

## Architecture Overview

### Signal Flow
1. **AI Agents** analyze market data and generate signals
2. **SignalAggregator** combines agent signals into consensus
3. **AutomatedSignalProcessor** applies regime filters and veto checks
4. **EnhancedTradeExecutor** executes approved signals
5. **PriorityExitManager** manages position exits
6. **Week9RiskManager** tracks risk and enforces position limits

### Exit Management
- **Time-based exits** - Close positions after max hold time
- **Profit-taking** - Close at target profit levels
- **Stop-loss** - Close at loss limits
- **Trailing stops** - Lock in profits as price moves favorably
- **Direction flip** - Close when consensus reverses
- **Intelligent exits** - AI-driven exit decisions

## Configuration

### Trading Parameters (server/config/TradingConfig.ts)
- **Base exits**: -1.2% stop loss, 25 min max hold, 1.0% take profit
- **Regime adjustments**:
  - `trending_down`: 1.3x hold time, 1.5x stop loss
  - `trending_up`: 0.8x hold time, 1.2x stop loss
  - `range_bound`: 1.1x hold time, 1.0x stop loss
  - `high_vol`: 0.7x hold time, 0.8x stop loss
  - `low_vol`: 1.3x hold time, 1.5x stop loss

### Consensus Thresholds
- **Minimum consensus strength**: 43%
- **Minimum agents required**: 3
- **Minimum confidence per agent**: 45%
- **Regime override**: 80% consensus + 4 agents + 0.05% price move

## Monitoring

### 24-Hour Continuous Monitoring
A scheduled monitoring task runs every 30 minutes to check:
- Server uptime
- Open positions and unrealized P&L
- Recently closed trades and realized P&L
- Win rate and total P&L
- Pipeline log for rejection reasons
- Any new bugs or regressions

### Key Metrics
- **Win Rate**: Target >60% (currently 50%)
- **Net P&L**: Target positive (currently +$2.69 in latest session)
- **Hold Times**: 20-33 minutes depending on regime
- **Server Uptime**: 99.9%

## Database Schema

The database includes tables for:
- `users` - User accounts and authentication
- `paperPositions` - Paper trading positions
- `positions` - Live trading positions
- `signals` - Generated trading signals
- `agents` - AI agent data and consensus
- `alerts` - Trading alerts and notifications

Export the database with:
```bash
node scripts/export-database.mjs
```

## Development

### Running Tests
```bash
pnpm test
```

### Building for Production
```bash
pnpm build
```

### Starting Production Server
```bash
pnpm start
```

## Troubleshooting

### Server won't start
- Check DATABASE_URL is correct
- Verify MySQL is running and accessible
- Check all required environment variables are set

### No trades being opened
- Check if MACRO VETO is active (Fed/FOMC events)
- Verify agents are generating signals (check logs)
- Check if regime is blocking trades (trending_down blocks bullish trades)

### Trades are all losses
- Check if exit parameters are too tight
- Verify stop loss and take profit levels
- Check if regime detection is correct

## Support

For issues or questions, refer to:
- `ARCHITECTURE.md` - System architecture
- `todo.md` - Known issues and improvements
- `server/services/` - Service implementations
- `server/agents/` - Agent implementations

## License

Proprietary - SEER Trading Platform

## Last Updated

March 13, 2026 - Phase 45 Bug Fixes & Live Monitoring
