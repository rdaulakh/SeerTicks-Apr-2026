# SEER Risk Management Rules
# Applies to: server/risk/**, server/services/PriorityExitManager.ts, server/services/EnhancedTradeExecutor.ts, server/services/Week9RiskManager.ts

## Position Sizing (Kelly Criterion + VaR)
- Kelly fraction: **0.25** (quarter Kelly — conservative, reduces volatility vs full Kelly)
- Default win rate: 50%, payoff ratio: 1.5 (from historical data in `agentAccuracy` table)
- Hard caps enforced by `Week9RiskManager`:
  - Max portfolio VaR (95%): **8%** — reject new trade if this would be breached
  - Max VaR per new trade: **2%** — single trade risk limit
  - Max open positions: **3** simultaneously
  - Single trade hard limit: configured in TradingConfig.ts
- Correlation check: block if new position correlates > 0.95 with existing; reduce size if > 0.85
- Position ramp-up: start at 10% of max size for new strategies, scale up with proven results

## Regime Detection (ATR-Based Volatility Classification)
```
low_vol:    ATR < 1.5%
normal_vol: 1.5% ≤ ATR < 4%
high_vol:   ATR ≥ 4%
```
- ATR measured over last 14 candles on relevant timeframe
- Regime recalculated on every price tick — not cached
- ALL exit parameters scale with regime — see regime multipliers below

## Regime-Aware Exit Multipliers
| Regime | Stop Loss Multiplier | Max Hold Multiplier | Rationale |
|---|---|---|---|
| low_vol | 1.5x (wider) | 1.3x (longer) | Give trades time to develop |
| normal_vol | 1.0x (base) | 1.0x (base) | Standard parameters |
| high_vol | 0.7x (tighter) | 0.8x (shorter) | Fast-moving markets, cut losses quick |

Base values (TradingConfig.ts): stop -1.2%, max hold 25 min, take profit 1.0%
Example in high_vol: stop = -1.2% × 0.7 = -0.84%, hold = 25 × 0.8 = 20 min

## PriorityExitManager — Exit Priority Order
1. **Emergency stop** (kill switch): exits ALL positions immediately
2. **Daily loss circuit breaker**: triggered if daily loss > 5% of starting balance
3. **Hard stop-loss**: price hit stop level (regime-adjusted)
4. **Max hold time**: position open longer than maxHoldTime (regime-adjusted)
5. **Take profit target**: price hit take profit level
6. **Momentum crash**: >0.8% PnL drop in 2 min while position is losing → exit immediately
7. **Thesis invalid**: `expectedPath` validation fails → intelligent exit
8. **Direction flip**: consensus flips to opposite direction (with cooldown enforced)
9. **Trailing stop**: active after take profit target hit and +1.0% peak — trails 0.5% from peak
10. **Confidence decay**: losing positions — deferred to hard exit rules (confidence decay disabled for losers)

## Circuit Breakers
- **Emergency stop**: set `emergencyStopActive = true` → all new trades blocked, all positions closed
- **Daily loss limit** (5%): triggered by `Week9RiskManager`, wired to `IntelligentExitManager`
- **Max open positions** (3): `EnhancedTradeExecutor` checks before any new entry
- **Macro veto**: `MacroVetoEnforcer` blocks trades during FOMC/Fed events
- **Direction flip cooldown** (2 min): prevents whipsaw entries after direction change

## Trade Quality Scoring
- `calculateTradeQuality()`: grades closed trades A–F based on P&L, hold time, entry score, exit reason
- Grade A: profitable, held appropriate time, clean entry/exit
- Grade F: loss, held too long, poor entry, circuit breaker exit
- Trade quality scores feed `AgentWeightManager` — good quality trades weighted more in Brier score
- `pnlAfterCosts` is the primary signal for weight adjustment — not raw P&L

## Correlation & Portfolio Checks
- Before opening a new position: calculate correlation with all open positions
- Correlation matrix updated on each new position open
- High correlation (>0.95): block trade entirely — same risk as doubling existing position
- Moderate correlation (0.85–0.95): reduce new position size proportionally
- Correlation check runs in `Week9RiskManager.checkCorrelation()`

## Live Trading Safety Guardrails (RealTradingEngine)
- Single trade hard limit: never exceed configured max per trade in dollars
- Position reconciliation: compare local DB positions vs actual exchange every 60s
- On reconciliation mismatch: alert admin, do NOT auto-resolve — requires human confirmation
- `cancelOrder()`: implemented (was stubbed in early phases) — always cancel before overwriting
- `emergencyStopLiveTrading()` / `resumeLiveTrading()`: exposed via `seerMultiRouter` for admin use
