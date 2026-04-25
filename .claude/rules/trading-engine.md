# SEER Trading Engine Rules
# Applies to: server/services/GlobalMarketEngine.ts, server/services/UserTradingSession.ts, server/services/AutomatedSignalProcessor.ts, server/config/TradingConfig.ts

## Architecture: Shared Observation, Per-User Decisions
- `GlobalMarketEngine`: Singleton — one instance for the entire platform
  - Manages 29 agents per symbol, generates signals for ALL users simultaneously
  - Never store user-specific state here — this is shared infrastructure
- `UserTradingSession`: Per-user instance — one per active user
  - Consumes signals from GlobalMarketEngine
  - Applies user-specific agent weights, risk limits, trading parameters
  - Makes trade execution decisions independently per user

## TradingConfig.ts — Single Source of Truth (CRITICAL)
- ALL trading parameters live in `server/config/TradingConfig.ts`
- NEVER hardcode thresholds, percentages, or timing values in service files
- Changes to TradingConfig propagate automatically to all consuming services
- Key params (Phase 45 values — verify current values in file):
  - `minConsensusStrength`: 0.12 (rescaled from pre-Phase-40 ~0.60 range)
  - `minConfidence`: 0.10
  - `stopLoss`: -1.2%
  - `maxHoldTime`: 25 min
  - `takeProfitTarget`: 1.0%
  - `directionFlipCooldown`: 2 min

## Signal Pipeline Flow
```
CoinbasePublicWS (price tick)
  → GlobalMarketEngine distributes to 29 agents
  → Agents analyze asynchronously
  → AutomatedSignalProcessor.aggregateSignals()
  → Consensus check: strength > minConsensusStrength?
  → ML quality gate (non-blocking)
  → R:R pre-validation (reject if R:R < 1.5:1)
  → Price confirmation (last 5m candle confirms direction)
  → EnhancedTradeExecutor.executeTrade()
```

## Consensus Mechanics (Phase 40 — CRITICAL)
- Agents output confidence in range **0.05–0.20** — NOT 0–1
- This is NOT a bug — Phase 40 rescaled all agent outputs and thresholds
- `minConsensusStrength` = 0.12 (in the 0.05–0.20 range, NOT 0.6 in 0–1 range)
- Weighted average across all voting agents — weights in `agentWeights` table (per-user)
- Direction flip cooldown: 2 min after any direction change — prevents whipsaw
- Dead zone protection: near 50/50 consensus → no trade (ambiguous market)

## Veto System
- `DeterministicFallback` agent: can veto trades on extreme market conditions
- `PositionConsensusAgent`: blocks new entries if existing positions losing badly
- `MacroVetoEnforcer`: blocks trades during high-impact economic events (Fed/FOMC)
- Vetoes are hard stops — cannot be overridden by high consensus
- Veto state cached with 2-min TTL — re-evaluated on every fast tick cycle

## Expected Path Validation
- On trade entry: store entry-time market prediction as JSON in `positions.expectedPath`
- During hold: periodically revalidate current price vs expected path
- If price deviates significantly from expected path → flag `thesis_invalid`
- `thesis_invalid` positions exit early via `PriorityExitManager`
- Do NOT remove expectedPath from positions schema — critical for intelligent exit decisions

## Paper vs Live Trading
- `tradingMode` enum column (`'paper'` | `'live'`) on all 5 trading tables
- Same DB tables, same logic — only `EnhancedTradeExecutor` target differs
- Paper: `PaperTradingEngine` (simulated wallet/positions)
- Live: `RealTradingEngine` (actual Coinbase/Binance exchange calls)
- ALWAYS filter by `tradingMode` in queries — never mix modes

## Signal History Ring Buffer
- `seerMainMulti.ts`: `signalHistory[]` stores 5-min snapshots (288 entries = 24h)
- Used by `seerMultiRouter` for real-time dashboard — not raw DB queries
- Do NOT replace with DB queries for real-time data — ring buffer is intentional performance choice

## GlobalMarketEngine Singleton Management
- `server/_core/index.ts` boots `GlobalMarketEngine` at startup
- `stop()` must call `removeAllListeners()` — 14+ event handlers leak without it
- Never create multiple `GlobalMarketEngine` instances — singleton enforced in constructor
- WebSocket listeners tracked per-user — remove on disconnect to prevent memory leaks
