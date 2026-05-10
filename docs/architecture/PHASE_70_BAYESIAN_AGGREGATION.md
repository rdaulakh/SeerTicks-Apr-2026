# Phase 70 — Bayesian Signal Aggregation with Covariance

**Status:** Design + scaffolding. Multi-week to fully ship.

## Problem statement

Today's consensus is a weighted average of agent signals
(`AutomatedSignalProcessor.aggregateSignals`). Each agent emits a
direction + confidence; the processor multiplies by a per-agent weight
and averages. There are 30+ agents. Many of them measure overlapping
phenomena:

- `RSI`, `MACD`, `Stochastic`, `Williams %R` — all derive from the same
  recent price series. They are highly correlated — when price drops,
  all of them say "bearish" together.
- `OrderFlowAnalyst`, `OrderbookImbalanceAgent`, `SpotTakerFlowAgent`,
  `PerpTakerFlowAgent`, `LiquidityVacuumAgent` — all read from the order
  book and recent trades. Heavy overlap.
- `WhaleAlert`, `WhaleWallAgent`, `WhaleTransactionAnalyst`,
  `OnChainFlowAnalyst` — all derive from on-chain data. Nontrivially
  correlated when one large wallet moves.

When 5 correlated agents all fire bullish, the naive weighted average
counts that as "5 bullish votes" when it's really one piece of
information seen 5 times. **Result: false confidence on consensus.**

Symptom: `consensus.strength` of 0.85 looks decisive until you realize
4 of the 5 agents are reading the same 5-minute candle. True
information content is closer to 0.45.

## Target architecture

Two changes:

### 1. Agent correlation matrix
Compute pairwise agent direction correlation over the last N closed
trades or N rolling windows. Persist to `agent_correlations` table:
`(agentA, agentB, symbol, correlation, sampleSize, lastUpdated)`.

### 2. Effective-information aggregation
Replace naive weighted average with information-theoretic aggregation:

```
For each symbol/timestamp:
  signals = [(agent, direction, confidence)] from current snapshot
  Build covariance matrix Σ from agent_correlations table.
  Compute effective_n = inverse of average correlation
    e.g. 5 agents pairwise-corr 0.8 → effective_n ≈ 1.25
  posterior_belief = Bayesian update:
    prior ~ Beta(1, 1)
    each signal contributes evidence weighted by:
      agent_weight × confidence × (1 / effective_correlation_with_others)
  posterior_mean → consensus.strength
  posterior_std → consensus.uncertainty (NEW field — surfaces in the audit)
```

The trade gate becomes "posterior_mean > threshold AND posterior_std < uncertainty_cap".
Today we only check the first; a high-mean / high-uncertainty consensus
is exactly when the system gets fooled by correlated agent groups.

## Migration plan (high-level, 3-4 weeks)

| Week | Work |
|---|---|
| 1 | Add `agent_correlations` table + Drizzle schema. |
| 1 | Background job that recomputes pairwise correlations weekly from `agentSignals` + `paperTrades` join. |
| 2 | New `BayesianAggregator` class. Implements posterior_mean + posterior_std from a list of signals + correlation matrix. Pure function — directly testable. |
| 2 | Unit tests on synthetic data: 5 perfectly-correlated agents should give same posterior as 1 agent. 5 independent agents should give 5× the certainty. |
| 3 | Wire into `AutomatedSignalProcessor.aggregateSignals` behind a feature flag (`bayesian_aggregation: true`). Emit BOTH old + new consensus values for the first week so we can A/B in production. |
| 3 | Update consensus tracking dashboards to show posterior_std. |
| 4 | Cut over: bayesian becomes default, naive weighted-average kept for backward-compat. |

## Scaffolding to add today

A new `server/agents/AgentCorrelationTracker.ts` is the right starter
file (not delivered in this session — flagged as TODO in the catalog).
It would:
- Subscribe to closed trades (we already have `position_closed` event).
- For each closed trade, query the agent signals at entry time.
- Update a rolling correlation matrix in memory + persist daily.

## What this DOESN'T fix

- Doesn't change which 30 agents we run.
- Doesn't fix individual agent quality (Phase 62 audit findings).
- Doesn't help with regime detection — that's a different signal class.

## Verification gate

Phase 70 ships when:
1. A backtest with `bayesian_aggregation: true` produces measurably
   different (and better-calibrated) entries than the naive aggregation
   on the same historical window.
2. The auditor's "agent dead-weight" check (Phase 59) starts seeing
   improvements as correlated dead-weights stop dragging the average.
3. A scenario with 5 correlated bullish agents + 1 bearish technical
   shows posterior_std > threshold and the trade is correctly skipped.
