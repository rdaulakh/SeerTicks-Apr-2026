# SEER — Autonomous Crypto Trading Platform

## Project Overview

SEER is an autonomous crypto trading platform that runs 24/7 with zero manual intervention. It uses 29 specialized AI agents to generate consensus-based trading signals, executes trades with sophisticated risk management, and continuously learns from trade outcomes via an ML feedback loop.

**Phase-driven development**: architecture evolves in numbered phases (currently Phase 45+). Always check git history for phase context before modifying core systems.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript, Vite, Tailwind CSS 4, TanStack Query 5, tRPC client |
| Backend | Node.js 22+, Express 4, tRPC 11 (type-safe RPC), Socket.io 4 |
| Database | MySQL 8 via Drizzle ORM (schema in `drizzle/schema.ts`) |
| Cache | Redis 5 (rate limiting, caching via ioredis) |
| AI/ML | OpenAI GPT-4 (agent reasoning), native TS TradeSuccessPredictor (logistic regression) |
| Charts | Lightweight Charts (candlestick), Recharts (analytics) |
| Exchange APIs | Coinbase (primary), Binance (fallback) |
| Storage | AWS S3 (historical data, backtest exports) |
| Auth | JWT (jose library), bcrypt, optional Manus OAuth |

## Project Structure

```
SEERTICKS_CODE/
├── server/
│   ├── agents/             # 19+ agent implementations (~15k LOC)
│   ├── services/           # 124 services (engines, managers, processors)
│   │   ├── GlobalMarketEngine.ts    # Singleton — platform-level market observer
│   │   ├── UserTradingSession.ts   # Per-user trade decision engine
│   │   ├── AutomatedSignalProcessor.ts  # Signal consensus + filtering
│   │   ├── EnhancedTradeExecutor.ts # Execution + risk checks
│   │   ├── PriorityExitManager.ts  # Exit management
│   │   └── PaperTradingEngine.ts   # Paper trading wallet/positions
│   ├── routers/            # 43 tRPC routers
│   ├── execution/          # Trade execution (paper + live)
│   ├── risk/               # Week9RiskManager, position sizing, Kelly
│   ├── orchestrator/       # StrategyOrchestrator, TieredDecisionMaking
│   ├── backtest/           # Backtesting engines
│   ├── ml/                 # TradeSuccessPredictor, EnsemblePredictor, RL
│   ├── monitoring/         # Health checks, performance metrics
│   └── config/
│       └── TradingConfig.ts   # SINGLE SOURCE OF TRUTH for all trading parameters
├── client/src/
│   ├── pages/              # Dashboard, Positions, Performance, Settings, etc.
│   └── components/         # Shared UI components
└── drizzle/
    └── schema.ts           # Database schema (all tables defined here)
```

## Key Domain Concepts

- **GlobalMarketEngine**: Singleton — generates signals once for ALL users. 29 agents analyze each symbol.
- **UserTradingSession**: Per-user — consumes global signals, applies user-specific weights + risk limits.
- **Consensus Strength**: Weighted average of agent signals (0–1). Must exceed `minConsensusStrength` (0.12 rescaled) to trade.
- **Confidence**: Individual agent signal confidence. Phase 40: agents output 0.05–0.20 range (NOT 0–1).
- **Execution Score**: Tactical entry timing quality (0–100 scale).
- **Regime**: Market volatility state — `low_vol` (<1.5% ATR) / `normal_vol` (1.5–4%) / `high_vol` (>4%). Scales ALL exit parameters.
- **Expected Path**: Entry-time market prediction stored as JSON in positions. Used for thesis validation.
- **Alpha Decay**: Flag when a pattern's win rate degrades — retire from alpha library.
- **Paper vs Live**: Same logic, different execution paths. `tradingMode` enum column segregates DB records.
- **Kelly Criterion**: Quarter Kelly (0.25 fraction) for position sizing. VaR hard cap: 8% portfolio, 2% per trade.

## Agent Weight Categories

| Category | Agents | Weight Bonus |
|---|---|---|
| Fast (technical, pattern, order flow) | 100% base | — |
| Slow (sentiment, news, macro) | +20% bonus | Applied per category |
| Phase 2 (whale, funding, liquidation, on-chain, volume) | +50% bonus | Applied per category |

## Critical Trading Parameters (TradingConfig.ts — do not hardcode elsewhere)

- `minConsensusStrength`: 0.12 (Phase 40 rescaled from old 0.60 range)
- `minConfidence`: 0.10
- `stopLoss`: -1.2% (Phase 17: widened from -0.8%)
- `maxHoldTime`: 25 min (Phase 45: widened from 15 min)
- `takeProfitTarget`: 1.0%
- `directionFlipCooldown`: 2 min (prevents whipsaw)

## Common Commands

```bash
# Dev server (frontend + backend together)
npm run dev                    # Starts both client (port 3000) and server

# Type checking
npx tsc --noEmit               # REQUIRED before committing

# Database
npx drizzle-kit generate       # Generate migration from schema changes
npx drizzle-kit migrate        # Apply migrations
npx drizzle-kit studio         # Visual DB browser

# Testing
npm test                       # Jest unit tests
```

## Critical Paths (handle with extra care)

1. **TradingConfig.ts** — single source of truth; changes ripple everywhere — never hardcode elsewhere
2. **Consensus mechanics** — agents output 0.05–0.20 (Phase 40); thresholds scaled accordingly
3. **Regime-aware exits** — stops and hold times scale with ATR volatility; check `PriorityExitManager`
4. **Position sizing** — Kelly + VaR + correlation checks all enforced; never bypass `Week9RiskManager`
5. **Live vs paper trading** — same tables with `tradingMode` column; never mix modes in queries
6. **GlobalMarketEngine singleton** — shared state; per-user mutations go in `UserTradingSession`
7. **Veto system** — `DeterministicFallback` + `MacroVetoEnforcer` can block trades; respect vetoes
8. **Data gap resilience** — CoinbaseWS → REST fallback → Binance; never assume live feed is current

## Conventions

- All trading parameters in `server/config/TradingConfig.ts` — never hardcode in services
- tRPC procedures for all API calls — no raw REST routes for trading operations
- Drizzle ORM for all DB operations — never raw SQL unless Drizzle can't express it
- `tradingMode` filter on ALL paper/live queries — `where(eq(schema.table.tradingMode, mode))`
- Phase numbers in commit messages — always note which phase a change belongs to
- Agent signals are 0.05–0.20 confidence range (post Phase 40 rescaling) — not 0–1
- ML quality gate is non-blocking — ML failure never prevents a trade
- `logger.ts` for all logging — never `console.log` in server code

## Environment Variables (key ones)

```
DATABASE_URL             # MySQL connection string
JWT_SECRET               # ≥32 chars, fatal exit if missing in production
REDIS_URL                # Redis connection string
OPENAI_API_KEY           # Agent reasoning (GPT-4)
COINBASE_API_KEY / COINBASE_API_SECRET  # Primary exchange
BINANCE_API_KEY / BINANCE_SECRET_KEY    # Fallback exchange
WHALE_ALERT_API_KEY      # Large transaction monitoring
DUNE_API_KEY             # On-chain analytics
COOKIE_NAME              # Session cookie name
CORS_ORIGINS             # Comma-separated allowed origins
```

## SEER Domain Rules (`.claude/rules/`)

| File | Scope |
|---|---|
| `trading-engine.md` | GlobalMarketEngine, UserTradingSession, signal pipeline, consensus |
| `agents.md` | 29 agents, AgentBase, weights, categories, signal format |
| `risk-management.md` | Kelly criterion, VaR, regime-aware exits, circuit breakers |
| `database.md` | Drizzle ORM, MySQL schema, migrations, query patterns |
| `websockets.md` | Socket.io price feeds, event architecture, per-user rooms |
| `trpc-api.md` | tRPC router patterns, procedure types, client usage |
