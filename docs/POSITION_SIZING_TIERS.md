# SEER Position Sizing Tiers Documentation

## Overview

SEER uses a tiered position sizing system that scales position size based on consensus strength above the dynamic threshold. This institutional-grade approach ensures:

1. **Risk Management**: Smaller positions for lower conviction signals
2. **Capital Efficiency**: Larger positions for high-conviction opportunities
3. **Drawdown Control**: Prevents over-concentration in any single trade

## Position Sizing Tiers

| Tier | Position Size | Confidence Excess | Description |
|------|--------------|-------------------|-------------|
| **SCOUT** | 3% | 0-10% above threshold | Test positions for uncertain conditions |
| **MODERATE** | 5% | 10-20% above threshold | Moderate conviction trades |
| **STANDARD** | 7% | 20-30% above threshold | Standard confirmed signals |
| **STRONG** | 10% | 30-40% above threshold | Strong multi-agent consensus |
| **HIGH** | 15% | 40-50% above threshold | High conviction opportunities |
| **MAX** | 20% | 50%+ above threshold | Maximum conviction alpha signals |

## How Position Size is Calculated

### Step 1: Calculate Weighted Consensus Score

The consensus score combines signals from fast and slow agents:

```
Fast Score (100% base):
- Technical Analyst: 40%
- Pattern Matcher: 35%
- Order Flow Analyst: 25%

Slow Score (20% bonus):
- Sentiment Analyst: 33.33%
- News Sentinel: 33.33%
- Macro Analyst: 33.33%

Total Score = Fast Score + (Slow Score × 0.20) + Timeframe Bonus
Range: -130% to +130%
```

### Step 2: Determine Dynamic Threshold

The threshold adjusts based on market regime (ATR volatility):

| Volatility | ATR Range | Threshold |
|------------|-----------|-----------|
| High | >5% | 55% |
| Medium | 3-5% | 45% |
| Low | <3% | 40% |

Additionally, regime multipliers adjust the base threshold:

| Regime | Multiplier | Effect |
|--------|------------|--------|
| Trending | 0.80× | Lower threshold (follow trends) |
| Volatile | 1.40× | Higher threshold (avoid whipsaws) |
| Ranging | 1.10× | Slightly higher (avoid false breakouts) |

### Step 3: Calculate Confidence Excess

```
Confidence Excess = |Total Score| - Threshold
```

### Step 4: Map to Position Tier

Based on the confidence excess, the system selects the appropriate tier:

```typescript
if (excess >= 50) return { size: 0.20, type: 'MAX' };
if (excess >= 40) return { size: 0.15, type: 'HIGH' };
if (excess >= 30) return { size: 0.10, type: 'STRONG' };
if (excess >= 20) return { size: 0.07, type: 'STANDARD' };
if (excess >= 10) return { size: 0.05, type: 'MODERATE' };
if (excess >= 0)  return { size: 0.03, type: 'SCOUT' };
return { size: 0, type: 'NONE' };
```

## Example Calculations

### Example 1: Medium Volatility, Trending Market

**Inputs:**
- Fast Score: +70%
- Slow Score: +50%
- ATR: 4% (medium volatility)
- Regime: Trending

**Calculation:**
1. Total Score = 70 + (50 × 0.20) = 70 + 10 = **80%**
2. Base Threshold = 45% (medium volatility)
3. Regime-Adjusted Threshold = 45% × 0.80 = **36%**
4. Confidence Excess = 80 - 36 = **44%**
5. Position Tier = **HIGH (15%)**

### Example 2: High Volatility, Volatile Market

**Inputs:**
- Fast Score: +60%
- Slow Score: +40%
- ATR: 6% (high volatility)
- Regime: Volatile

**Calculation:**
1. Total Score = 60 + (40 × 0.20) = 60 + 8 = **68%**
2. Base Threshold = 55% (high volatility)
3. Regime-Adjusted Threshold = 55% × 1.40 = **77%**
4. Confidence Excess = 68 - 77 = **-9%** (below threshold)
5. Position Tier = **NONE (0%)** - No trade

### Example 3: Low Volatility, Ranging Market

**Inputs:**
- Fast Score: +55%
- Slow Score: +30%
- ATR: 2% (low volatility)
- Regime: Ranging

**Calculation:**
1. Total Score = 55 + (30 × 0.20) = 55 + 6 = **61%**
2. Base Threshold = 40% (low volatility)
3. Regime-Adjusted Threshold = 40% × 1.10 = **44%**
4. Confidence Excess = 61 - 44 = **17%**
5. Position Tier = **MODERATE (5%)**

## Risk Management Constraints

### Portfolio-Level Limits

| Constraint | Limit | Purpose |
|------------|-------|---------|
| Max Portfolio Heat | 40% | Total capital at risk |
| Max Correlated Exposure | 30% | Prevent concentration in correlated assets |
| Max Single Position | 20% | Cap individual position size |
| Max Concurrent Positions | 10 | Diversification requirement |

### Trade-Level Defaults

| Parameter | Default | Range |
|-----------|---------|-------|
| Stop Loss | 5% | 1-20% |
| Take Profit | 10% | 2-50% |
| Trailing Stop Activation | 5% profit | - |
| Trailing Stop Distance | 3% | - |
| Risk Per Trade | 2% | - |

## Adjusting Position Tiers

### Conservative Approach

For lower risk tolerance, adjust the tiers downward:

```typescript
positionTiers: {
  scout: 0.02,      // 2%
  moderate: 0.03,   // 3%
  standard: 0.05,   // 5%
  strong: 0.07,     // 7%
  high: 0.10,       // 10%
  max: 0.15,        // 15%
}
```

### Aggressive Approach

For higher risk tolerance (experienced traders only):

```typescript
positionTiers: {
  scout: 0.05,      // 5%
  moderate: 0.08,   // 8%
  standard: 0.12,   // 12%
  strong: 0.15,     // 15%
  high: 0.20,       // 20%
  max: 0.25,        // 25%
}
```

**Warning**: Aggressive position sizing increases both potential returns AND potential drawdowns. Only use with proper risk management and sufficient capital.

## Backtesting Position Tiers

Use the Backtesting page (`/backtesting`) to test different position tier configurations:

1. **Run Backtest**: Test a specific configuration against historical data
2. **Compare Configs**: Compare multiple configurations side-by-side
3. **Review Metrics**: Analyze win rate, Sharpe ratio, max drawdown, and profit factor

### Key Metrics to Monitor

| Metric | Target Range | Warning Signs |
|--------|--------------|---------------|
| Win Rate | 55-65% | <50% indicates poor signal quality |
| Sharpe Ratio | 1.5-2.5 | <1.0 indicates poor risk-adjusted returns |
| Max Drawdown | <25% | >30% indicates excessive risk |
| Profit Factor | >1.5 | <1.2 indicates marginal profitability |
| Trades/Week | 25-40 | <10 may miss opportunities, >60 may overtrade |

## Implementation Reference

### TieredDecisionMaking.ts

The core position sizing logic is in `/server/orchestrator/TieredDecisionMaking.ts`:

- `calculateWeightedScore()`: Computes the weighted consensus score
- `getExecutionThreshold()`: Returns volatility-based threshold
- `calculatePositionSize()`: Maps confidence excess to position tier
- `makeExecutionDecision()`: Combines all logic into final decision

### StrategyOrchestrator.ts

The orchestrator uses these functions in `/server/orchestrator/StrategyOrchestrator.ts`:

- `getRegimeAwareThreshold()`: Applies regime multipliers
- `calculateConsensusWithAgentThresholds()`: Agent-specific filtering
- `generateRecommendation()`: Creates final trade recommendation

## Best Practices

1. **Start Conservative**: Begin with lower position sizes until you understand the system
2. **Monitor Drawdowns**: If max drawdown exceeds 20%, reduce position sizes
3. **Backtest Changes**: Always backtest before changing position tier configuration
4. **Review Regime Performance**: Check how each regime performs and adjust multipliers
5. **Track Tier Distribution**: Monitor which tiers are most profitable

## Changelog

- **v1.0** (Dec 2024): Initial implementation with 6 tiers (3-20%)
- **v1.1** (Dec 2024): Added regime-aware threshold adjustments
- **v1.2** (Dec 2024): Integrated with backtesting system
