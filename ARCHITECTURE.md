# SEER Platform Architecture

> **Last updated:** February 22, 2026 (Phase 14E)
> **Status:** Production — GlobalMarketEngine + UserTradingSession architecture

---

## System Overview

SEER is an autonomous crypto trading platform powered by 29 AI agents per symbol, running 24/7 with zero manual intervention. The platform observes markets globally, generates consensus signals, and executes trades per-user based on individual risk settings.

### Core Design Principle

**Shared observation, per-user decisions.** Market analysis runs once for all users via `GlobalMarketEngine`. Each user's trade decisions are handled by a lightweight `UserTradingSession` that subscribes to global signals and applies user-specific weights, thresholds, and risk limits.

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENT (React 19)                       │
│  Pages → tRPC hooks → WebSocket (live prices/signals)       │
├─────────────────────────────────────────────────────────────┤
│                     API LAYER (tRPC)                        │
│  routers.ts → seerMultiRouter, healthRouter, settingsRouter │
│  EngineAdapter → unified API surface for all endpoints      │
├─────────────────────────────────────────────────────────────┤
│               GLOBAL MARKET ENGINE (Singleton)              │
│  GlobalMarketEngine → GlobalSymbolAnalyzer (per symbol)     │
│  29 agents × N symbols = shared market intelligence         │
├─────────────────────────────────────────────────────────────┤
│             USER TRADING SESSIONS (Per-User)                │
│  UserSessionManager → UserTradingSession (per user)         │
│  Signal consumption → trade decisions → position mgmt       │
├─────────────────────────────────────────────────────────────┤
│                   DATA INFRASTRUCTURE                       │
│  PriceFeedService ← CoinbasePublicWS + BinanceRestFallback  │
│  DataGapResilience ← reconnect backfill + REST polling      │
│  MySQL (TiDB) + S3 storage                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Components

### GlobalMarketEngine (`server/services/GlobalMarketEngine.ts`)

Singleton started at server boot. Never stops. Creates one `GlobalSymbolAnalyzer` per tracked symbol (default: BTC-USD, ETH-USD).

| Property | Value |
|---|---|
| Lifecycle | Server boot → runs forever |
| Scope | Platform-level (no userId) |
| Symbols | Loaded from `globalSymbols` DB table |
| Output | Raw agent signals emitted as events |
| Resource usage | 2 symbols × 29 agents = 58 instances total |

### GlobalSymbolAnalyzer (`server/services/GlobalSymbolAnalyzer.ts`)

One per symbol. Runs all 29 agents and emits raw signals. No trade decisions — purely observational.

### UserTradingSession (`server/services/UserTradingSession.ts`)

Lightweight per-user session that subscribes to global signals and makes trade decisions.

**Owns (per-user):**
- AgentWeightManager (user's agent weight preferences)
- AutomatedSignalProcessor (applies weights → trade/no-trade)
- EnhancedTradeExecutor (executes with user's risk limits)
- IntelligentExitManager (manages exits for user's positions)
- PaperTradingEngine (user's wallet, positions, history)
- PositionManager + RiskManager

**Subscribes to (shared):**
- GlobalMarketEngine → raw agent signals
- CoinbasePublicWS → price ticks (via PriceFeedService)

### UserSessionManager (`server/services/UserSessionManager.ts`)

Singleton managing all `UserTradingSession` instances. Routes global signals to the correct user sessions.

### EngineAdapter (`server/services/EngineAdapter.ts`)

Drop-in replacement for the legacy `getSEERMultiEngine(userId)`. Wraps `UserTradingSession` + `GlobalMarketEngine` to expose the same API surface that routers, WebSocket, and background services expect. Ensures backward compatibility during the migration.

---

## AI Agents (29 per symbol)

All agents run inside `GlobalSymbolAnalyzer` and produce signals consumed by user sessions.

| Category | Agents |
|---|---|
| Technical | TechnicalAnalyst, PatternMatcher, PatternDetection, VolumeProfileAnalyzer |
| On-Chain | OnChainAnalyst, OnChainFlowAnalyst, WhaleTracker, WhaleAlertAgent |
| Sentiment | SentimentAnalyst, NewsSentinel, MacroAnalyst |
| Market Microstructure | OrderFlowAnalyst, FundingRateAnalyst, LiquidationHeatmap, IcebergOrderDetector |
| ML/Prediction | MLPredictionAgent, ForexCorrelationAgent |
| Risk | PositionConsensusAgent, DeterministicFallback |

### Consensus Mechanism

Signals flow through a tiered decision-making pipeline:
1. **Fast Score** — weighted average of agent signals (agent weights per user)
2. **Slow Bonus** — regime-aware adjustment based on market conditions
3. **Threshold Check** — dynamic threshold (base 0.25, regime-adjusted)
4. **Veto System** — risk agents can veto trades
5. **Entry Confirmation** — EntryConfirmationFilter validates before execution

---

## Price Data Pipeline

```
CoinbasePublicWS (primary)
    ↓
PriceFeedService (cache + distribution)
    ↓                          ↓
GlobalSymbolAnalyzer     UserTradingSession
(agent analysis)         (trade decisions)

DataGapResilience (Phase 13E):
├── WebSocket reconnect backfill (Coinbase REST, Binance fallback)
├── REST fallback poller (activates at 5s stale, polls at 2s)
└── Rapid gap scanner (every 5 minutes)
```

### Data Sources

| Source | Type | Purpose |
|---|---|---|
| Coinbase WebSocket | Primary | Real-time trades and ticker |
| Binance REST | Fallback | Price data when WS is down |
| CoinGecko | Supplementary | Market cap, volume verification |
| DeFiLlama | On-chain | TVL, protocol metrics |
| Whale Alert | On-chain | Large transaction monitoring |

---

## WebSocket Architecture

`WebSocketServerMulti` manages per-user WebSocket connections:
- Authenticates via session cookie
- Routes engine events to the correct user via `sendToUser(userId, message)`
- Broadcasts price ticks to all connected clients
- Handles subscribe/unsubscribe for symbol-specific data

---

## Database Schema (Key Tables)

| Table | Purpose |
|---|---|
| `users` | Auth, roles, preferences |
| `positions` | Open and closed trading positions |
| `paperPositions` | Paper trading positions |
| `walletHistory` | Balance snapshots over time |
| `ticks` / `archived_ticks` | Price tick data with source tracking |
| `dataGapLogs` | Gap detection and recovery tracking |
| `globalSymbols` | Platform-wide tracked symbols |
| `agentWeights` | Per-user agent weight configurations |
| `tradingModeConfig` | Per-user trading mode settings |
| `systemConfig` | Platform-level configuration |

---

## Server Boot Sequence

1. Express + tRPC server starts
2. `GlobalMarketEngine.start()` — creates analyzers for all symbols
3. `UserSessionManager` initialized — ready to create sessions on demand
4. `CoinbasePublicWS` connects — price data flows
5. `DataGapResilience` starts — monitors for gaps, activates fallbacks
6. `BackgroundEngineManager` starts — manages user sessions lifecycle
7. WebSocket server ready — accepts client connections

---

## File Structure (Key Directories)

```
server/
  services/
    GlobalMarketEngine.ts      ← Singleton market observer
    GlobalSymbolAnalyzer.ts    ← Per-symbol agent runner
    UserTradingSession.ts      ← Per-user trade decisions
    UserSessionManager.ts      ← Session lifecycle manager
    EngineAdapter.ts           ← Legacy API compatibility layer
    DataGapResilience.ts       ← Gap detection + recovery
    priceFeedService.ts        ← Price cache + distribution
    backgroundEngineManager.ts ← Session lifecycle automation
  agents/                      ← 29 AI agent implementations
  orchestrator/                ← StrategyOrchestrator, TieredDecisionMaking
  execution/                   ← PaperTradingEngine, trade execution
  monitoring/                  ← Health checks, performance metrics
  routers/                     ← tRPC endpoint definitions
  websocket/                   ← WebSocketServerMulti
  _core/                       ← Framework plumbing (auth, LLM, etc.)
client/
  src/pages/                   ← Dashboard, Agents, Strategy, Positions, Performance
  src/components/              ← Reusable UI components
drizzle/
  schema.ts                    ← Database schema definitions
```

---

## Migration History

| Phase | Description | Status |
|---|---|---|
| 14A | GlobalMarketEngine + GlobalSymbolAnalyzer | Complete |
| 14B | UserTradingSession + UserSessionManager | Complete |
| 14C | EngineAdapter shim layer | Complete |
| 14D | Remove all legacy SEERMultiEngine runtime imports | Complete |
| 14E | Delete seerMainMulti.ts (4,070 lines removed) | Complete |
| 13E | DataGapResilience (backfill + REST polling) | Complete |
