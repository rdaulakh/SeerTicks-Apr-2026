# ROOT CAUSE ANALYSIS — SEER Loss-Making Trades

## Data Summary
- **937 closed positions**: 259 wins (27.6%), 528 losses (56.3%), 150 breakeven
- **Total P&L: -$2,090** 
- **95.7% long bias** (897 long, 40 short)
- **Average loss per trade: -$2.23**

## TOP 5 ROOT CAUSES (Priority Order)

### 1. CONFIDENCE DECAY EXITS ARE THE #1 KILLER (-$710, 160 trades)
**Problem**: The ConfidenceDecayTracker exits positions too aggressively when agent consensus fluctuates.
- Formula: EXIT_THRESHOLD = PEAK_CONFIDENCE - (GAP × DECAY_RATIO)
- When GAP is small (entry ≈ peak), the threshold is basically at entry confidence
- Any minor confidence dip triggers exit, usually at a loss
- **baseDecayRatio: 0.70** means exit when confidence drops 70% of the gap from peak
- But with minConsensusStrength at 0.40 (40%), many entries have LOW initial confidence
- When peak barely exceeds entry, the decay window is tiny → premature exits

**Fix**: 
- Increase minHoldSecondsForDecayExit from 120s to 300s (5 min)
- Add minimum gap requirement: don't trigger decay exit if gap < 10%
- For PROFITABLE positions, disable confidence decay entirely (let profit targets handle it)

### 2. "Phase23 recalculated_real_price" EXITS (-$753, 333 trades)
**Problem**: This is the LARGEST loss category. These are exits from a Phase 23 migration/recalculation that closed positions with incorrect exit prices.
- 333 trades with avg -$2.26 loss
- 97 wins, 236 losses — the recalculation itself is creating losses

**Fix**: This is a legacy data issue. Need to investigate Phase23 recalculation logic and ensure it's not still running. If it is, disable it.

### 3. EMERGENCY 5% EXITS (-$204, 68 trades)  
**Problem**: Positions bleeding to -5% before being emergency-closed.
- The confidence decay and hard stop should catch these MUCH earlier
- Hard stop is at -1.0% but positions are reaching -5%
- This means the hard stop is NOT being enforced properly

**Fix**: 
- Verify hard stop enforcement in PriorityExitManager
- The -5% emergency exit is in PositionGuardian — this should be a LAST RESORT
- Hard stop at -1.0% should catch 100% of these

### 4. CONSENSUS THRESHOLDS TOO LOW (Entry Quality)
**Problem**: minConsensusStrength: 0.40 (40%), minConfidence: 0.15 (15%), minCombinedScore: 0.20
- System enters trades with VERY weak consensus
- Only 40% combined agreement needed → entering on noise
- 15% minimum confidence is absurdly low
- This explains the 27.6% win rate — garbage in, garbage out

**Fix**:
- Raise minConsensusStrength from 0.40 to 0.60
- Raise minConfidence from 0.15 to 0.40
- Raise minCombinedScore from 0.20 to 0.40
- Raise minExecutionScore from 30 to 45

### 5. SL/TP DISTANCE TOO WIDE
**Problem**: From audit data:
- BTC-USD long: avg SL 4.47%, avg TP 8.80%
- ETH-USD long: avg SL 4.56%, avg TP 8.95%
- These are WAY too wide for crypto scalping/swing trading
- ATR multipliers: high_volatility uses 3.5x ATR for stop loss
- With BTC ATR ~$1500-2000 on 1h candles, that's a $5,250-7,000 stop distance

**Fix**:
- Reduce high_volatility stopLossAtrMultiplier from 3.5 to 2.0
- Reduce trending_up stopLossAtrMultiplier from 2.0 to 1.5
- Reduce range_bound stopLossAtrMultiplier from 1.5 to 1.2
- Tighten TP ratios accordingly

### 6. POSITION_REPLACED EXITS (-$52, 108 trades)
**Problem**: System is replacing positions (flipping direction) too aggressively.
- 108 trades closed as "position_replaced" with net -$52 loss
- Position flip logic closes existing position at market price

**Fix**: Add minimum profit requirement before allowing position flip.

## IMPLEMENTATION PLAN
1. Tighten consensus thresholds (entry quality)
2. Fix confidence decay (too aggressive exits)
3. Tighten SL/TP distances (ATR multipliers too wide)
4. Verify hard stop enforcement
5. Disable Phase23 recalculation if still running
6. Add position flip protection
