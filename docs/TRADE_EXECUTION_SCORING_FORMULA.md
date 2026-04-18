# SEER Trading Platform: Trade Execution Scoring Formula

**Version:** 2.0 (Combined Score System)  
**Last Updated:** January 26, 2026  
**Author:** Manus AI

---

## Executive Summary

The SEER Trading Platform uses a multi-layered scoring system to determine trade execution for both **bullish (LONG)** and **bearish (SHORT)** positions. The system combines agent confidence signals with execution timing scores through a weighted formula, ensuring high-quality signals are not rejected due to temporary market conditions.

---

## 1. Trade Execution Flow Overview

The trade execution decision flows through three stages:

| Stage | Component | Purpose |
|-------|-----------|---------|
| **Stage 1** | Agent Signal Generation | Individual agents analyze market data and generate directional signals |
| **Stage 2** | Consensus Calculation | Weighted voting aggregates agent signals into consensus direction |
| **Stage 3** | Combined Score Filtering | Final filter using confidence + execution score to approve/reject |

---

## 2. Agent Weights for Consensus Calculation

The system uses weighted voting where each agent's contribution is proportional to its assigned weight and confidence level.

### 2.1 Fast Agents (Real-Time Analysis)

| Agent | Weight | Role |
|-------|--------|------|
| **TechnicalAnalyst** | 40% | Price action, indicators (RSI, MACD, SuperTrend, VWAP) |
| **PatternMatcher** | 35% | Chart patterns, candlestick formations |
| **OrderFlowAnalyst** | 25% | Order book imbalance, whale activity |

### 2.2 Slow Agents (Contextual Analysis)

| Agent | Weight | Role |
|-------|--------|------|
| **SentimentAnalyst** | 33.33% | Social sentiment, Fear & Greed Index |
| **NewsSentinel** | 33.33% | News impact, market-moving events |
| **MacroAnalyst** | 33.33% | Macro regime, correlation analysis |

### 2.3 Signal Processing Weights

| Agent | Processing Weight |
|-------|------------------|
| TechnicalAnalyst | 0.40 |
| PatternMatcher | 0.35 |
| OrderFlowAnalyst | 0.25 |
| SentimentAnalyst | 0.15 |
| NewsSentinel | 0.10 |
| MacroAnalyst | 0.10 |

---

## 3. Consensus Calculation Formula

### 3.1 Weighted Consensus Score

The consensus direction and strength are calculated using weighted voting:

```
For each agent signal:
  confidenceWeight = agentWeight × signalConfidence
  
  if signal == "bullish":
    bullishWeight += confidenceWeight
  else if signal == "bearish":
    bearishWeight += confidenceWeight
    
  totalWeight += agentWeight

bullishStrength = bullishWeight / totalWeight
bearishStrength = bearishWeight / totalWeight

consensusDirection = bullishStrength > bearishStrength ? "bullish" : "bearish"
consensusStrength = max(bullishStrength, bearishStrength)
```

### 3.2 Consensus Threshold

The minimum consensus strength required for trade execution:

> **Consensus Threshold: 65%**

If `consensusStrength < 0.65`, the signal is rejected with reason "Weak consensus."

---

## 4. Combined Score Formula (Critical for Trade Approval)

### 4.1 The Problem Solved

Previously, signals were filtered using a strict execution score threshold (≥45). This caused high-confidence signals (73-94%) to be rejected when execution timing was suboptimal, missing profitable trades.

### 4.2 Combined Score Calculation

The new formula balances directional confidence with tactical timing:

```
Combined Score = (Confidence × 0.6) + (ExecutionScore / 100 × 0.4)
```

| Component | Weight | Description |
|-----------|--------|-------------|
| **Confidence** | 60% | Agent's directional conviction (0.0 - 1.0) |
| **ExecutionScore** | 40% | Tactical timing quality (0 - 100) |

### 4.3 Minimum Combined Score Threshold

> **Minimum Combined Score: 50%**

Signals with `combinedScore >= 0.50` are approved for execution.

### 4.4 Example Calculations

**Example 1: High Confidence, Low Execution Score (PASSES)**
```
Confidence: 73.36% (0.7336)
ExecutionScore: 44
Combined Score = (0.7336 × 0.6) + (44/100 × 0.4)
              = 0.4402 + 0.176
              = 0.6162 (61.62%)
Result: PASSES (61.62% > 50%)
```

**Example 2: Very High Confidence, Zero Execution Score (PASSES)**
```
Confidence: 94% (0.94)
ExecutionScore: 0
Combined Score = (0.94 × 0.6) + (0/100 × 0.4)
              = 0.564 + 0
              = 0.564 (56.4%)
Result: PASSES (56.4% > 50%)
```

**Example 3: Low Confidence, Low Execution Score (FAILS)**
```
Confidence: 40% (0.40)
ExecutionScore: 30
Combined Score = (0.40 × 0.6) + (30/100 × 0.4)
              = 0.24 + 0.12
              = 0.36 (36%)
Result: FAILS (36% < 50%)
```

---

## 5. Execution Score Calculation

The execution score (0-100) measures tactical timing quality. It is calculated by the TechnicalAnalyst agent.

### 5.1 Base Score

```
Base Score: 50 (neutral starting point)
```

### 5.2 Scoring Components

| Component | Points | Condition |
|-----------|--------|-----------|
| **Proximity to Key Levels** | +30 | Price < 0.5% from support/resistance |
| | +20 | Price 0.5-1% from support/resistance |
| | +10 | Price 1-2% from support/resistance |
| **Volume Confirmation** | +25 | Volume spike > 50% |
| | +15 | Volume increase 20-50% |
| | +5 | Volume increase 0-20% |
| | -15 | Volume decline > 30% |
| **Momentum (MACD)** | +25 | MACD histogram > 500 |
| | +15 | MACD histogram 200-500 |
| | +5 | MACD histogram 50-200 |
| **Volatility (ATR)** | +20 | ATR ratio > 1.5 (high volatility) |
| | +10 | ATR ratio 1.2-1.5 |
| | -10 | ATR ratio < 0.7 (low volatility) |
| **SuperTrend Alignment** | +15 | Signal matches SuperTrend, price within 2% |
| | +10 | Signal matches SuperTrend direction |
| | -10 | Signal conflicts with SuperTrend |
| **VWAP Position** | +10 | Bullish + price > VWAP, or Bearish + price < VWAP |
| | -5 | Signal conflicts with VWAP position |
| **Signal Alignment Penalty** | -15 | Bullish near resistance, or Bearish near support |

### 5.3 Execution Score Formula

```
ExecutionScore = 50 (base)
               + proximityToLevels (0 to +30)
               + volumeConfirmation (-15 to +25)
               + momentumAcceleration (0 to +25)
               + volatilityRegime (-10 to +20)
               + superTrendAlignment (-10 to +15)
               + vwapPosition (-5 to +10)
               + signalAlignmentPenalty (-15 to 0)

Final ExecutionScore = clamp(ExecutionScore, 0, 100)
```

---

## 6. Bullish vs Bearish Trade Execution

### 6.1 Bullish (LONG) Trade Conditions

A LONG position is opened when:

1. **Consensus Direction** = "bullish"
2. **Consensus Strength** ≥ 65%
3. **At least one agent** has confidence ≥ 60%
4. **Combined Score** ≥ 50%

**Execution Action:** BUY / LONG

### 6.2 Bearish (SHORT) Trade Conditions

A SHORT position is opened when:

1. **Consensus Direction** = "bearish"
2. **Consensus Strength** ≥ 65%
3. **At least one agent** has confidence ≥ 60%
4. **Combined Score** ≥ 50%

**Execution Action:** SELL / SHORT

### 6.3 Direction Determination

The direction is determined by the consensus calculation:

```typescript
if (bullishStrength > bearishStrength) {
  direction = 'bullish';  // LONG trade
  action = 'buy';
} else {
  direction = 'bearish';  // SHORT trade
  action = 'sell';
}
```

---

## 7. Position Sizing Tiers

Position size is determined by the total confidence score relative to the threshold:

| Trade Type | Confidence Excess | Position Size |
|------------|-------------------|---------------|
| **MAX** | ≥ 50% above threshold | 20% of capital |
| **HIGH** | ≥ 40% above threshold | 15% of capital |
| **STRONG** | ≥ 30% above threshold | 10% of capital |
| **STANDARD** | ≥ 20% above threshold | 7% of capital |
| **MODERATE** | ≥ 10% above threshold | 5% of capital |
| **SCOUT** | ≥ 0% above threshold | 3% of capital |
| **NONE** | Below threshold | 0% (no trade) |

---

## 8. Complete Trade Decision Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT SIGNAL GENERATION                       │
│  TechnicalAnalyst → PatternMatcher → OrderFlowAnalyst           │
│  SentimentAnalyst → NewsSentinel → MacroAnalyst                 │
│  Each agent outputs: signal (bullish/bearish/neutral)           │
│                      confidence (0-100%)                         │
│                      executionScore (0-100)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FILTER 1: ACTIONABLE SIGNALS                  │
│  Remove all neutral signals                                      │
│  If no actionable signals → SKIP (reason: "All neutral")        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FILTER 2: CONSENSUS CHECK                     │
│  Calculate weighted consensus (bullish vs bearish)               │
│  If consensusStrength < 65% → SKIP (reason: "Weak consensus")   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FILTER 3: CONFIDENCE CHECK                    │
│  Filter signals with confidence ≥ 60%                            │
│  If no high-confidence signals → SKIP (reason: "Low confidence")│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FILTER 4: COMBINED SCORE                      │
│  For each signal:                                                │
│    combinedScore = (confidence × 0.6) + (execScore/100 × 0.4)   │
│  Filter signals with combinedScore ≥ 50%                         │
│  If no signals pass → SKIP (reason: "Low combined scores")      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TRADE EXECUTION                               │
│  Direction: bullish → LONG, bearish → SHORT                     │
│  Position Size: Based on confidence tier (3-20%)                 │
│  Entry: Current market price                                     │
│  Stop Loss: ATR-based or agent-recommended                       │
│  Take Profit: Risk/reward ratio based                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Configuration Parameters

| Parameter | Default Value | Description |
|-----------|---------------|-------------|
| `minConfidence` | 0.60 (60%) | Minimum individual agent confidence |
| `consensusThreshold` | 0.65 (65%) | Minimum consensus strength |
| `minCombinedScore` | 0.50 (50%) | Minimum combined score for approval |
| `confidenceWeight` | 0.60 | Weight of confidence in combined score |
| `executionScoreWeight` | 0.40 | Weight of execution score in combined score |
| `defaultExecutionScore` | 50 | Default when execution score not provided |

---

## 10. Summary

The SEER Trading Platform executes trades when:

1. **Multiple agents agree** on direction (bullish or bearish)
2. **Consensus strength** exceeds 65%
3. **At least one agent** has 60%+ confidence
4. **Combined Score** (60% confidence + 40% execution) exceeds 50%

This balanced approach ensures:
- High-confidence directional signals are not missed due to timing
- Both LONG and SHORT trades are executed symmetrically
- Position sizing scales with conviction level
- The system remains selective while capturing opportunities

---

## References

- AutomatedSignalProcessor.ts: Combined score filtering implementation
- TechnicalAnalyst.ts: Execution score calculation
- TieredDecisionMaking.ts: Weighted consensus and position sizing
- StrategyOrchestrator.ts: Trade orchestration and agent coordination
