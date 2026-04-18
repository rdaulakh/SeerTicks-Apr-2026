# SEER Trading Platform Database

## Export Date
January 13, 2026

## Database Type
MySQL/TiDB (Cloud-hosted)

## Schema Location
The complete database schema is defined in:
- `drizzle/schema.ts` - TypeScript schema definitions
- `drizzle/migrations/` - Migration files

## How to Restore

1. Set up a MySQL/TiDB database
2. Configure DATABASE_URL environment variable
3. Run migrations: `pnpm db:push`
4. The schema will be automatically created

## Key Tables

### User Management
- `users` - User accounts and authentication
- `settings` - User preferences and settings
- `otpVerifications` - Email verification codes

### Trading Configuration
- `tradingModeConfig` - Paper/Live trading mode settings
- `userExchanges` - Exchange API credentials (encrypted)
- `userSymbols` - Trading symbols per user

### Trading Data
- `positions` - Open and closed positions
- `orders` - Order history
- `trades` - Executed trades
- `paperTrades` - Paper trading history

### Agent System
- `agentSignals` - Trading signals from AI agents
- `agentPerformance` - Agent performance metrics
- `agentActivities` - Agent activity logs

### Market Data
- `priceHistory` - Historical price data
- `candleData` - OHLCV candle data
- `whaleAlerts` - Large transaction alerts

## Notes
- All sensitive data (API keys, passwords) are encrypted
- The schema supports both paper and live trading modes
- Migrations are managed by Drizzle ORM
