# SEER Exit Strategy - Implementation Plan

## Phase 1: Critical Fixes (Immediate)

### 1.1 Fix Position Registration with IntelligentExitManager

**File**: `server/services/AutomatedTradeExecutor.ts`

**Problem**: Positions are created but not registered with exit manager.

**Solution**:
```typescript
// After line 248 (order execution), add robust registration:

// CRITICAL: Register position with IntelligentExitManager
console.log(`[AutomatedTradeExecutor] 📝 Attempting to register position with exit manager...`);
console.log(`[AutomatedTradeExecutor] - intelligentExitManager exists: ${!!this.intelligentExitManager}`);
console.log(`[AutomatedTradeExecutor] - order.filledPrice: ${order.filledPrice}`);
console.log(`[AutomatedTradeExecutor] - order.id: ${order.id}`);

if (this.intelligentExitManager) {
  // Always register, even if filledPrice is missing (use currentPrice as fallback)
  const entryPrice = order.filledPrice || currentPrice;
  
  try {
    this.intelligentExitManager.addPosition({
      id: order.id,
      symbol,
      side: recommendation.action === 'buy' ? 'long' : 'short',
      entryPrice,
      currentPrice: entryPrice,
      quantity,
      remainingQuantity: quantity,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      entryTime: Date.now(),
      marketRegime: regime,
      originalConsensus: recommendation.confidence,
      atr,
    });
    console.log(`[AutomatedTradeExecutor] ✅ Position ${order.id} registered with IntelligentExitManager`);
  } catch (err) {
    console.error(`[AutomatedTradeExecutor] ❌ Failed to register position:`, err);
  }
} else {
  console.warn(`[AutomatedTradeExecutor] ⚠️ IntelligentExitManager not available - position will not be monitored!`);
}
```

### 1.2 Connect WebSocket Price Feed to Position Monitor

**File**: `server/seerMainMulti.ts`

**Add after line 766 (after intelligentExitManager.start())**:
```typescript
// Connect price feed to IntelligentExitManager for real-time P&L
const { priceFeedService } = await import('./services/priceFeedService');
priceFeedService.on('price_update', (data: { symbol: string; price: number }) => {
  if (this.intelligentExitManager) {
    this.intelligentExitManager.updatePrice(data.symbol, data.price);
  }
});
console.log('[SEERMultiEngine] ✅ Price feed connected to IntelligentExitManager');
```

### 1.3 Implement Exit Execution Handler

**File**: `server/seerMainMulti.ts`

**Update the executeExit callback (line 731)**:
```typescript
executeExit: async (positionId, quantity, reason) => {
  console.log(`[SEERMultiEngine] 🎯 Executing intelligent exit: ${positionId} qty=${quantity} reason=${reason}`);
  
  try {
    // Find the position in database
    const position = await this.paperTradingEngine?.getPositionById(positionId);
    if (!position) {
      console.error(`[SEERMultiEngine] Position ${positionId} not found`);
      return;
    }
    
    // Execute the exit order
    const exitOrder = await this.paperTradingEngine?.placeOrder({
      symbol: position.symbol,
      type: 'market',
      side: position.side === 'buy' ? 'sell' : 'buy', // Opposite side to close
      quantity: quantity,
      strategy: 'intelligent_exit',
      reason: reason,
    });
    
    console.log(`[SEERMultiEngine] ✅ Exit order placed: ${exitOrder?.id}`);
    this.emit('intelligent_exit_executed', { positionId, quantity, reason, orderId: exitOrder?.id });
  } catch (error) {
    console.error(`[SEERMultiEngine] ❌ Exit execution failed:`, error);
  }
},
```

---

## Phase 2: Real-Time Position Monitoring (Short-Term)

### 2.1 Create Unified Position Monitor

**New File**: `server/services/UnifiedPositionMonitor.ts`

This service will:
1. Load all open positions from database on startup
2. Subscribe to WebSocket price updates
3. Calculate real-time P&L on every tick
4. Trigger exit checks based on multiple strategies

```typescript
import { EventEmitter } from 'events';
import { getDb } from '../db';
import { paperPositions } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

interface MonitoredPosition {
  id: number;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  highWaterMark: number;
  lowWaterMark: number;
  entryTime: number;
  lastUpdate: number;
}

export class UnifiedPositionMonitor extends EventEmitter {
  private positions: Map<number, MonitoredPosition> = new Map();
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;
  
  // Configuration
  private readonly PRICE_UPDATE_INTERVAL_MS = 10; // 10ms for HFT-grade
  private readonly STRATEGY_CHECK_INTERVAL_MS = 100; // 100ms for strategy checks
  
  constructor(private userId: number) {
    super();
  }
  
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // Load existing positions from database
    await this.loadPositions();
    
    // Start strategy check loop
    this.checkInterval = setInterval(() => {
      this.runStrategyChecks();
    }, this.STRATEGY_CHECK_INTERVAL_MS);
    
    console.log(`[UnifiedPositionMonitor] Started with ${this.positions.size} positions`);
  }
  
  async loadPositions() {
    const db = await getDb();
    if (!db) return;
    
    const dbPositions = await db
      .select()
      .from(paperPositions)
      .where(eq(paperPositions.userId, this.userId))
      .where(eq(paperPositions.status, 'open'));
    
    for (const pos of dbPositions) {
      this.positions.set(pos.id, {
        id: pos.id,
        symbol: pos.symbol,
        side: pos.side as 'long' | 'short',
        entryPrice: Number(pos.entryPrice),
        quantity: Number(pos.quantity),
        currentPrice: Number(pos.entryPrice),
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        highWaterMark: Number(pos.entryPrice),
        lowWaterMark: Number(pos.entryPrice),
        entryTime: pos.createdAt.getTime(),
        lastUpdate: Date.now(),
      });
    }
  }
  
  updatePrice(symbol: string, price: number) {
    const now = Date.now();
    
    for (const [id, pos] of this.positions) {
      if (pos.symbol !== symbol) continue;
      
      // Update price
      pos.currentPrice = price;
      pos.lastUpdate = now;
      
      // Calculate P&L
      if (pos.side === 'long') {
        pos.unrealizedPnl = (price - pos.entryPrice) * pos.quantity;
        pos.unrealizedPnlPercent = ((price - pos.entryPrice) / pos.entryPrice) * 100;
      } else {
        pos.unrealizedPnl = (pos.entryPrice - price) * pos.quantity;
        pos.unrealizedPnlPercent = ((pos.entryPrice - price) / pos.entryPrice) * 100;
      }
      
      // Update high/low water marks
      if (price > pos.highWaterMark) pos.highWaterMark = price;
      if (price < pos.lowWaterMark) pos.lowWaterMark = price;
      
      // Emit update event
      this.emit('position_update', pos);
    }
  }
  
  private runStrategyChecks() {
    for (const [id, pos] of this.positions) {
      // Check trailing stop
      this.checkTrailingStop(pos);
      
      // Check time-based exit
      this.checkTimeBasedExit(pos);
      
      // Check profit targets
      this.checkProfitTargets(pos);
    }
  }
  
  private checkTrailingStop(pos: MonitoredPosition) {
    // Activate trailing stop after 1.5% profit
    if (pos.unrealizedPnlPercent < 1.5) return;
    
    // Calculate trailing stop level (0.5% from high water mark)
    const trailingStopPrice = pos.side === 'long'
      ? pos.highWaterMark * 0.995
      : pos.lowWaterMark * 1.005;
    
    // Check if triggered
    const triggered = pos.side === 'long'
      ? pos.currentPrice <= trailingStopPrice
      : pos.currentPrice >= trailingStopPrice;
    
    if (triggered) {
      this.emit('exit_signal', {
        positionId: pos.id,
        reason: 'trailing_stop',
        exitPrice: pos.currentPrice,
        pnlPercent: pos.unrealizedPnlPercent,
      });
    }
  }
  
  private checkTimeBasedExit(pos: MonitoredPosition) {
    const holdTimeHours = (Date.now() - pos.entryTime) / (1000 * 60 * 60);
    
    // Exit after 4 hours if profitable
    if (holdTimeHours >= 4 && pos.unrealizedPnlPercent > 0) {
      this.emit('exit_signal', {
        positionId: pos.id,
        reason: 'time_based_exit',
        exitPrice: pos.currentPrice,
        pnlPercent: pos.unrealizedPnlPercent,
      });
    }
  }
  
  private checkProfitTargets(pos: MonitoredPosition) {
    // Partial exits at profit levels
    const profitLevels = [
      { pnl: 1.0, exitPercent: 25 },
      { pnl: 1.5, exitPercent: 25 },
      { pnl: 2.0, exitPercent: 25 },
    ];
    
    for (const level of profitLevels) {
      if (pos.unrealizedPnlPercent >= level.pnl) {
        this.emit('partial_exit_signal', {
          positionId: pos.id,
          reason: `profit_target_${level.pnl}%`,
          exitPercent: level.exitPercent,
          exitPrice: pos.currentPrice,
          pnlPercent: pos.unrealizedPnlPercent,
        });
      }
    }
  }
  
  addPosition(pos: MonitoredPosition) {
    this.positions.set(pos.id, pos);
    console.log(`[UnifiedPositionMonitor] Added position ${pos.id} (${pos.symbol})`);
  }
  
  removePosition(id: number) {
    this.positions.delete(id);
    console.log(`[UnifiedPositionMonitor] Removed position ${id}`);
  }
  
  getPositions() {
    return Array.from(this.positions.values());
  }
  
  stop() {
    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}
```

---

## Phase 3: Consensus-Based Exit Integration (Medium-Term)

### 3.1 Add Exit Consensus to Agent Signals

**Modify each agent** to include exit recommendations:

```typescript
// In AgentBase.ts or each agent
interface AgentSignal {
  signal: 'buy' | 'sell' | 'hold';
  confidence: number;
  reasoning: string;
  
  // NEW: Exit recommendations for open positions
  exitRecommendation?: {
    action: 'hold' | 'partial_exit' | 'full_exit';
    urgency: 'low' | 'medium' | 'high';
    reason: string;
  };
}
```

### 3.2 Implement Exit Consensus Calculator

```typescript
// In AutomatedSignalProcessor.ts
private calculateExitConsensus(signals: AgentSignal[], position: Position): ExitDecision {
  const exitVotes = signals.filter(s => 
    s.exitRecommendation?.action === 'full_exit' ||
    s.exitRecommendation?.action === 'partial_exit'
  );
  
  const exitConsensus = exitVotes.length / signals.length;
  
  if (exitConsensus >= 0.6) { // 60% consensus for exit
    return {
      action: 'exit',
      confidence: exitConsensus,
      reason: exitVotes.map(v => v.exitRecommendation?.reason).join('; '),
    };
  }
  
  return { action: 'hold', confidence: 1 - exitConsensus };
}
```

---

## Phase 4: HFT-Grade Optimizations (Long-Term)

### 4.1 Latency Tracking

```typescript
// Add to critical path
const latencyTracker = {
  signalGenerated: 0,
  consensusCalculated: 0,
  exitDecisionMade: 0,
  orderPlaced: 0,
  orderConfirmed: 0,
};

// Log latency at each step
console.log(`[Latency] Signal→Consensus: ${latencyTracker.consensusCalculated - latencyTracker.signalGenerated}ms`);
console.log(`[Latency] Consensus→Decision: ${latencyTracker.exitDecisionMade - latencyTracker.consensusCalculated}ms`);
console.log(`[Latency] Decision→Order: ${latencyTracker.orderPlaced - latencyTracker.exitDecisionMade}ms`);
console.log(`[Latency] Total: ${latencyTracker.orderConfirmed - latencyTracker.signalGenerated}ms`);
```

### 4.2 Memory-Optimized Price Buffer

```typescript
// Use typed arrays for price history
class PriceBuffer {
  private prices: Float64Array;
  private timestamps: BigInt64Array;
  private index = 0;
  private size: number;
  
  constructor(size: number = 10000) {
    this.size = size;
    this.prices = new Float64Array(size);
    this.timestamps = new BigInt64Array(size);
  }
  
  push(price: number, timestamp: bigint) {
    this.prices[this.index] = price;
    this.timestamps[this.index] = timestamp;
    this.index = (this.index + 1) % this.size;
  }
}
```

---

## Implementation Priority

| Priority | Task | Estimated Time | Impact |
|----------|------|----------------|--------|
| P0 | Fix position registration | 1 hour | Critical |
| P0 | Connect price feed to exit manager | 30 min | Critical |
| P0 | Implement exit execution handler | 1 hour | Critical |
| P1 | Create UnifiedPositionMonitor | 2 hours | High |
| P1 | Load existing positions on startup | 30 min | High |
| P2 | Add exit consensus to agents | 4 hours | Medium |
| P2 | Implement exit consensus calculator | 2 hours | Medium |
| P3 | Add latency tracking | 1 hour | Low |
| P3 | Memory optimization | 2 hours | Low |

---

## Success Metrics

After implementation, the system should:

1. **Position Registration**: 100% of new positions registered with exit manager
2. **Price Updates**: < 50ms latency from WebSocket to exit check
3. **Exit Execution**: < 100ms from exit decision to order placement
4. **Profit Capture**: At least 50% of profitable positions closed before reversal
5. **Hold Time**: Average hold time < 4 hours for profitable trades

---

*Plan created: January 23, 2026*
