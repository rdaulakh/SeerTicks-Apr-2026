# SEER Agent Rules
# Applies to: server/agents/**, server/services/AutomatedSignalProcessor.ts

## Agent Base Class (AgentBase.ts)
- All agents extend `AgentBase` — do not bypass base class methods
- Base class provides: signal formatting, OpenAI client, confidence normalization, error handling
- `isSyntheticData` flag on `AgentSignal` interface — NEVER set to true in production agents
- Agents must return `AgentSignal` interface — not raw objects

## Signal Output Format (Phase 40 Standard)
```typescript
interface AgentSignal {
  agentName: string;
  direction: 'long' | 'short' | 'neutral';
  confidence: number;       // RANGE: 0.05–0.20 (Phase 40 rescaled — NOT 0–1)
  executionScore: number;   // 0–100 (tactical entry timing quality)
  reasoning: string;
  marketConditions: object;
  isSyntheticData: false;   // Must always be false in production
}
```

## The 29 Agents by Category

**Fast Agents (base weight 100% — real-time technical data):**
- TechnicalAnalyst: RSI, MACD, ATR, Bollinger Bands, EMA analysis
- PatternMatcher: Chart patterns, alpha library lookup, decay detection
- OrderFlowAnalyst: Bid/ask imbalance, trade flow, volume delta

**Slow Agents (+20% weight bonus — external data, slower refresh):**
- SentimentAnalyst: Social sentiment aggregation
- NewsAnalyst: Crypto news impact scoring
- MacroAnalyst: Macro environment (CPI, Fed rate, DXY) — stablecoin change tracking (NOT hardcoded 0)

**Phase 2 Agents (+50% weight bonus — on-chain / derivatives data):**
- WhaleTransactionAnalyst: Large wallet movements via Whale Alert API
- FundingRateAnalyst: Perpetual futures funding rate
- LiquidationHeatmapAnalyst: Liquidation clusters
- OnChainFlowAnalyst: Exchange inflows/outflows via DeFiLlama
- VolumeProfileAnalyst: Volume-at-price analysis

**Meta/Veto Agents (special roles — not in consensus voting):**
- DeterministicFallback: Emergency circuit breaker, veto authority
- PositionConsensusAgent: Position health checker, veto authority
- MacroVetoEnforcer: Economic event calendar, hard blocks during FOMC/Fed events

**ML Agents:**
- TradeSuccessPredictor: Logistic regression (TS, not Python), predicts trade success probability
- EnsemblePredictor: LSTM + Transformer ensemble, auto-rebalances based on accuracy

## Agent Weight Management (AgentWeightManager)
- Weights stored per-user in `agentWeights` DB table
- Brier score calibration: auto-recalculates every 50 trades
- `recordTradeOutcome()`: call on every trade close to update agent accuracy
- `AutomatedSignalProcessor` + `TieredDecisionMaking` both use `AgentWeightManager` as single source of truth
- NEVER maintain separate weight copies — always read from `AgentWeightManager`

## Staleness Penalty
- Signals cached with timestamp — slow agents (sentiment, news, macro) refresh less frequently
- Staleness penalty: linear decay after 2 min idle, 20% floor at 15 min
- Cached veto state TTL: 2 min — re-evaluated on every fast tick
- Never use a stale signal without applying staleness weight reduction

## ML Quality Gate (AutomatedSignalProcessor)
- `TradeSuccessPredictor` runs on every potential trade entry
- Low success probability (<35%): halve position size
- High success probability (>70%): full position size
- Gate is **non-blocking** — ML failure NEVER prevents a trade
- Gate uses real agent evidence (RSI, MACD, ATR, BB from TechnicalAnalyst) — not synthetic features

## No Mock Data Policy
- NEVER use `Math.random()` in agent signal generation — was a bug in early phases (fixed Phase 1)
- All on-chain data must come from real API calls: `FreeOnChainDataProvider`, DeFiLlama, Whale Alert
- All macro data must come from real calendar APIs — not hardcoded values
- `isSyntheticData: true` in any signal = immediate investigation required

## Alpha Library (winningPatterns table)
- Stores patterns with proven win rates and profit factors
- `alphaDecayFlag`: set to true when pattern win rate degrades below threshold
- Decayed patterns: stop using for entries, mark for review
- `PatternMatcher` checks alpha library before recommending any pattern-based entry
