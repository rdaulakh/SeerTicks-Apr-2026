# HFT and Institutional Trading Research

## Key Findings from Research

### HFT Characteristics (from investorsunderground.com)
1. **Holding Time**: HFT programs rarely hold positions for extended periods - often milliseconds to seconds
2. **Sharpe Ratio**: Maintain Sharpe ratio north of 10 due to virtually no holding time
3. **Latency**: Target roundtrip latency of 8.5-14.5 milliseconds
4. **Profit Consistency**: Some firms claim 1,000+ consecutive profitable trading days
5. **Volume**: HFT accounted for ~50% of US stock market volume in 2012

### Critical HFT Exit Strategies
1. **Speed-based exits**: Exit before market conditions change (milliseconds)
2. **Market making**: Exit by providing liquidity on both sides
3. **Arbitrage**: Exit immediately after capturing price discrepancy
4. **Front-running**: Exit after capturing thin profit margins

### Key Differences from SEER Current Implementation
| Aspect | HFT Standard | SEER Current |
|--------|-------------|--------------|
| Holding Time | Milliseconds to seconds | Hours to days |
| Exit Decision Speed | < 10ms | 100ms-5000ms |
| Exit Trigger | Price movement + speed | Consensus threshold |
| Position Monitoring | Tick-by-tick | 100ms intervals |
| Profit Target | 0.01-0.1% per trade | 1-10% per trade |

## Research Sources
- https://www.investorsunderground.com/high-frequency-trading/


## Algorithmic Trading Exit Strategies (from algotrade.vn)

### 4 Core Exit Strategies

1. **Fixed Threshold Strategy**
   - Pre-defined stop-loss and take-profit levels
   - Simple but doesn't adapt to market volatility
   - Risk: Can be triggered by temporary fluctuations

2. **Trailing Stop Strategy**
   - Threshold adjusts with price movement
   - Locks in profits as price moves favorably
   - Maintains fixed distance from high-water mark
   - **KEY INSIGHT**: Automatically protects profits

3. **Signal-Based Strategy**
   - Uses technical indicators (RSI, MACD, etc.)
   - Closes when indicators meet conditions
   - More adaptive to market conditions

4. **Time-Based Strategy**
   - Maximum holding period defined
   - Closes regardless of P&L at expiry
   - Good for intraday/scalping strategies

### Key Principle
> "Cut losses quickly, let profits run"

### SEER Gap Analysis
| Strategy | Implemented | Active | Issue |
|----------|-------------|--------|-------|
| Fixed Threshold | ✅ Yes | ❌ No | Static SL/TP not being monitored |
| Trailing Stop | ✅ Yes | ❌ No | UltraFastPositionMonitor not started |
| Signal-Based | ✅ Yes | ❌ No | ConsensusPositionManager not connected |
| Time-Based | ❌ No | ❌ No | Not implemented |

