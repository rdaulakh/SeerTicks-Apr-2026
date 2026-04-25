# SEER Database Rules
# Applies to: drizzle/schema.ts, server/routers/**, any file with Drizzle queries

## ORM: Drizzle + MySQL 8
- ALL schema definitions in `drizzle/schema.ts` — single source of truth
- Generate migrations: `npx drizzle-kit generate` (reads schema.ts diff)
- Apply migrations: `npx drizzle-kit migrate`
- NEVER hand-write SQL migrations — always generate from schema changes
- NEVER use raw SQL unless Drizzle ORM cannot express the query

## Key Tables

**Auth & Users:**
- `users`: id, email (unique), passwordHash, name, role, loginMethod, lastSignedIn
- `settings`: per-user trading preferences (paperTrading, maxPositionSize, stopLoss, etc.)
- `agentWeights`: per-user consensus formula weights (technicalWeight, patternWeight, etc.)
- `thresholdConfig`: per-user execution thresholds
- `userBias`: per-user directional bias (bullish/bearish/neutral)

**Trading Data:**
- `positions`: open live/paper trades (symbol, side, entryPrice, stopLoss, takeProfit, expectedPath, tradingMode)
- `trades`: completed trades with full stats (pnl, pnlAfterCosts, exitReason, agentSignals, tradeQualityScore)
- `paperPositions`: paper trading open positions (same columns + tradingMode = 'paper')
- `paperTrades`: paper trading closed trades
- `paperOrders` / `paperTransactions`: paper trading order book and transaction log
- `walletHistory`: balance snapshots over time

**Signal & Analysis:**
- `agentSignals`: raw signal records (agentName, direction, confidence, executionScore, marketConditions)
- `tradingSignals`: technical indicator signals
- `winningPatterns`: alpha library (patternName, symbol, winRate, profitFactor, alphaDecayFlag)
- `mlTrainingData`: ML training examples (agent evidence, outcome, qualityWeight)
- `agentAccuracy`: per-agent accuracy tracking (Brier scores)

**Health & Monitoring:**
- `systemHealth`: agent uptime, error counts, last heartbeat
- `healthMetrics`: latency, throughput percentiles
- `ticks` / `archived_ticks`: price history with source tracking

## tradingMode Column (CRITICAL)
```typescript
// ALWAYS filter by tradingMode — never mix paper and live data
const openPositions = await db
  .select()
  .from(schema.positions)
  .where(and(
    eq(schema.positions.userId, userId),
    eq(schema.positions.status, 'open'),
    eq(schema.positions.tradingMode, 'live')  // NEVER omit this
  ));
```

## Query Patterns
```typescript
// Drizzle query pattern — use .where() chains, not raw SQL
const trades = await db
  .select()
  .from(schema.trades)
  .where(and(
    eq(schema.trades.userId, userId),
    eq(schema.trades.tradingMode, mode)
  ))
  .orderBy(desc(schema.trades.createdAt))
  .limit(50);  // Always add .limit() on unbounded tables
```

## Critical Indexes (defined in schema.ts)
```
trades:          idx_trades_userId_status, idx_trades_userId_tradingMode, idx_trades_createdAt
positions:       idx_positions_userId_status, idx_positions_symbol
paperPositions:  idx_paperPositions_userId_status, idx_paperPositions_symbol
agentSignals:    idx_agentSignals_userId_timestamp, idx_agentSignals_agentName
tradingSignals:  idx_tradingSignals_userId_symbol, idx_tradingSignals_timestamp
agentAccuracy:   idx_agentAccuracy_userId_agentName, idx_agentAccuracy_symbol
candleData:      composite(symbol, interval, timestamp)
```
Before adding a new WHERE clause on any column — verify the index exists in schema.ts.

## Schema Changes
- Add column: `alter table` via migration — NEVER drop existing columns without confirming unused
- Rename column: expand-contract (add new → backfill → switch queries → drop old in separate migration)
- Add index: add `index()` to schema.ts, generate + apply migration
- `drizzle/schema.ts` changes MUST be committed before migration files — schema is the source

## systemConfig Table
- Key-value store for platform-level configuration
- Keys: strings, values: JSON strings
- Never use for per-user config (use `settings` table) — this is platform-wide only
- Example keys: `maintenance_mode`, `max_active_users`, `feature_flags`

## Candle Data & Ticks
- `ticks` table: rolling window — archive to `archived_ticks` after configurable retention period
- Gap scanner runs every 5 min — logs to `dataGapLogs` table
- Source tracking: every tick has `source` column (coinbase | binance) for data quality audit
- Never query raw ticks for analytics — aggregate to candle data first
