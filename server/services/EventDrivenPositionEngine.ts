/**
 * Event-Driven Position Engine
 * 
 * Institutional-grade A++ position management following HFT best practices:
 * - Event-driven (not time-driven) - reacts to every market tick
 * - Single writer, multi-reader model for lock-free operation
 * - In-memory state (no DB in hot path)
 * - Tick-indexed positions (no looping over all positions)
 * - Decoupled signal generation from position control
 * - Micro-batching for burst handling (0.5-1ms max)
 * - Deterministic scheduling with priority queues
 * 
 * Target: 1000+ ticks/sec processing with sub-millisecond latency
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type EventType = 
  | 'price_tick'
  | 'orderbook_update'
  | 'trade_print'
  | 'funding_rate'
  | 'liquidation'
  | 'news'
  | 'signal';

export type EventPriority = 1 | 2 | 3 | 4 | 5; // 1 = highest

export interface MarketEvent {
  type: EventType;
  symbol: string;
  timestamp: number; // High-resolution timestamp (performance.now())
  priority: EventPriority;
  data: any;
  sequenceId: number;
}

export interface PriceTickEvent extends MarketEvent {
  type: 'price_tick';
  data: {
    price: number;
    bid: number;
    ask: number;
    volume: number;
  };
}

export interface OrderBookEvent extends MarketEvent {
  type: 'orderbook_update';
  data: {
    bids: Array<[number, number]>; // [price, size]
    asks: Array<[number, number]>;
    imbalance: number;
  };
}

export interface PositionState {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  highWaterMark: number;
  lowWaterMark: number;
  drawdown: number;
  trailingStop: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  entryTime: number;
  lastUpdateTime: number;
  ticksProcessed: number;
  expectedPath: number; // Expected price trajectory
  deviation: number; // Current deviation from expected path
}

export interface StateSnapshot {
  timestamp: number;
  sequenceId: number;
  prices: Map<string, number>;
  positions: Map<string, PositionState>;
  orderBooks: Map<string, { bids: Array<[number, number]>; asks: Array<[number, number]> }>;
  fundingRates: Map<string, number>;
}

export interface PositionAction {
  type: 'exit' | 'reduce' | 'adjust_stop' | 'take_profit' | 'hedge';
  positionId: string;
  symbol: string;
  reason: string;
  urgency: 'immediate' | 'normal';
  params?: any;
}

export interface EngineConfig {
  maxTicksPerSecond: number;
  microBatchWindowMs: number;
  deviationTolerance: number; // Price deviation tolerance before action
  trailingStopPercent: number;
  maxDrawdownPercent: number;
  enableBackpressure: boolean;
  priorityDropThreshold: number; // Drop events below this priority when overwhelmed
}

// ============================================================================
// Ring Buffer for Lock-Free Event Queue
// ============================================================================

class RingBuffer<T> {
  private buffer: (T | null)[];
  private writeIndex: number = 0;
  private readIndex: number = 0;
  private size: number;

  constructor(size: number) {
    this.size = size;
    this.buffer = new Array(size).fill(null);
  }

  push(item: T): boolean {
    const nextWrite = (this.writeIndex + 1) % this.size;
    if (nextWrite === this.readIndex) {
      return false; // Buffer full
    }
    this.buffer[this.writeIndex] = item;
    this.writeIndex = nextWrite;
    return true;
  }

  pop(): T | null {
    if (this.readIndex === this.writeIndex) {
      return null; // Buffer empty
    }
    const item = this.buffer[this.readIndex];
    this.buffer[this.readIndex] = null;
    this.readIndex = (this.readIndex + 1) % this.size;
    return item;
  }

  peek(): T | null {
    if (this.readIndex === this.writeIndex) {
      return null;
    }
    return this.buffer[this.readIndex];
  }

  isEmpty(): boolean {
    return this.readIndex === this.writeIndex;
  }

  length(): number {
    if (this.writeIndex >= this.readIndex) {
      return this.writeIndex - this.readIndex;
    }
    return this.size - this.readIndex + this.writeIndex;
  }

  clear(): void {
    this.buffer.fill(null);
    this.writeIndex = 0;
    this.readIndex = 0;
  }
}

// ============================================================================
// Priority Queue for Deterministic Event Ordering
// ============================================================================

class PriorityEventQueue {
  private queues: Map<EventPriority, RingBuffer<MarketEvent>> = new Map();
  private totalEvents: number = 0;

  constructor(bufferSize: number = 10000) {
    // Initialize priority queues (1-5)
    for (let i = 1; i <= 5; i++) {
      this.queues.set(i as EventPriority, new RingBuffer<MarketEvent>(bufferSize));
    }
  }

  enqueue(event: MarketEvent): boolean {
    const queue = this.queues.get(event.priority);
    if (!queue) return false;
    
    const success = queue.push(event);
    if (success) this.totalEvents++;
    return success;
  }

  dequeue(): MarketEvent | null {
    // Process highest priority first
    for (let priority = 1; priority <= 5; priority++) {
      const queue = this.queues.get(priority as EventPriority);
      if (queue && !queue.isEmpty()) {
        const event = queue.pop();
        if (event) {
          this.totalEvents--;
          return event;
        }
      }
    }
    return null;
  }

  dequeueAbovePriority(minPriority: EventPriority): MarketEvent | null {
    for (let priority = 1; priority <= minPriority; priority++) {
      const queue = this.queues.get(priority as EventPriority);
      if (queue && !queue.isEmpty()) {
        const event = queue.pop();
        if (event) {
          this.totalEvents--;
          return event;
        }
      }
    }
    return null;
  }

  isEmpty(): boolean {
    return this.totalEvents === 0;
  }

  length(): number {
    return this.totalEvents;
  }

  dropLowPriority(threshold: EventPriority): number {
    let dropped = 0;
    for (let priority = threshold + 1; priority <= 5; priority++) {
      const queue = this.queues.get(priority as EventPriority);
      if (queue) {
        const count = queue.length();
        queue.clear();
        dropped += count;
        this.totalEvents -= count;
      }
    }
    return dropped;
  }
}

// ============================================================================
// Event-Driven Position Engine
// ============================================================================

export class EventDrivenPositionEngine extends EventEmitter {
  private config: EngineConfig;
  
  // Single writer state (only updated by state updater)
  private currentState: StateSnapshot;
  private sequenceCounter: number = 0;
  
  // Event queue
  private eventQueue: PriorityEventQueue;
  
  // Position subscriptions (symbol -> position IDs)
  private positionSubscriptions: Map<string, Set<string>> = new Map();
  
  // In-memory position states
  private positions: Map<string, PositionState> = new Map();
  
  // Performance metrics
  private ticksProcessed: number = 0;
  private totalLatency: number = 0;
  private maxLatency: number = 0;
  private lastSecondTicks: number = 0;
  private ticksPerSecond: number = 0;
  private lastTpsUpdate: number = 0;
  
  // Processing state
  private isProcessing: boolean = false;
  private processingPromise: Promise<void> | null = null;
  
  // Micro-batch buffer
  private microBatchBuffer: MarketEvent[] = [];
  private microBatchStartTime: number = 0;

  constructor(config?: Partial<EngineConfig>) {
    super();
    this.config = {
      maxTicksPerSecond: 10000,
      microBatchWindowMs: 0.5, // 0.5ms micro-batch window
      deviationTolerance: 0.005, // 0.5% deviation tolerance
      trailingStopPercent: 1.5,
      maxDrawdownPercent: 5,
      enableBackpressure: true,
      priorityDropThreshold: 3,
      ...config,
    };

    this.eventQueue = new PriorityEventQueue();
    this.currentState = this.createEmptySnapshot();
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Inject a market event (called by WebSocket handlers)
   * This is the ONLY entry point for market data
   */
  injectEvent(event: Omit<MarketEvent, 'sequenceId'>): void {
    const fullEvent: MarketEvent = {
      ...event,
      sequenceId: ++this.sequenceCounter,
    };

    // Apply backpressure if overwhelmed
    if (this.config.enableBackpressure && this.eventQueue.length() > 5000) {
      const dropped = this.eventQueue.dropLowPriority(this.config.priorityDropThreshold as EventPriority);
      if (dropped > 0) {
        this.emit('backpressure', { dropped, queueLength: this.eventQueue.length() });
      }
    }

    // Enqueue event
    if (!this.eventQueue.enqueue(fullEvent)) {
      this.emit('queue_overflow', { event: fullEvent });
      return;
    }

    // Trigger processing if not already running
    this.triggerProcessing();
  }

  /**
   * Add a position to monitor
   */
  addPosition(position: {
    id: string;
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    quantity: number;
    stopLoss?: number;
    takeProfit?: number;
  }): void {
    const currentPrice = this.currentState.prices.get(position.symbol) || position.entryPrice;
    
    const state: PositionState = {
      id: position.id,
      symbol: position.symbol,
      side: position.side,
      entryPrice: position.entryPrice,
      quantity: position.quantity,
      currentPrice,
      unrealizedPnL: 0,
      unrealizedPnLPercent: 0,
      highWaterMark: currentPrice,
      lowWaterMark: currentPrice,
      drawdown: 0,
      trailingStop: this.calculateTrailingStop(position.side, currentPrice),
      stopLoss: position.stopLoss || null,
      takeProfit: position.takeProfit || null,
      entryTime: performance.now(),
      lastUpdateTime: performance.now(),
      ticksProcessed: 0,
      expectedPath: currentPrice,
      deviation: 0,
    };

    this.positions.set(position.id, state);

    // Subscribe position to symbol events
    if (!this.positionSubscriptions.has(position.symbol)) {
      this.positionSubscriptions.set(position.symbol, new Set());
    }
    this.positionSubscriptions.get(position.symbol)!.add(position.id);

    this.emit('position_added', { positionId: position.id, symbol: position.symbol });
  }

  /**
   * Remove a position from monitoring
   */
  removePosition(positionId: string): void {
    const position = this.positions.get(positionId);
    if (!position) return;

    // Unsubscribe from symbol events
    const subs = this.positionSubscriptions.get(position.symbol);
    if (subs) {
      subs.delete(positionId);
      if (subs.size === 0) {
        this.positionSubscriptions.delete(position.symbol);
      }
    }

    this.positions.delete(positionId);
    this.emit('position_removed', { positionId });
  }

  /**
   * Get immutable state snapshot (for agents/strategies to read)
   */
  getSnapshot(): StateSnapshot {
    // Return a copy to ensure immutability
    return {
      timestamp: this.currentState.timestamp,
      sequenceId: this.currentState.sequenceId,
      prices: new Map(this.currentState.prices),
      positions: new Map(this.currentState.positions),
      orderBooks: new Map(this.currentState.orderBooks),
      fundingRates: new Map(this.currentState.fundingRates),
    };
  }

  /**
   * Get position state
   */
  getPosition(positionId: string): PositionState | undefined {
    return this.positions.get(positionId);
  }

  /**
   * Get all positions
   */
  getAllPositions(): PositionState[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    return {
      ticksProcessed: this.ticksProcessed,
      ticksPerSecond: this.ticksPerSecond,
      avgLatencyUs: this.ticksProcessed > 0 ? (this.totalLatency / this.ticksProcessed) * 1000 : 0,
      maxLatencyUs: this.maxLatency * 1000,
      queueLength: this.eventQueue.length(),
      positionCount: this.positions.size,
      subscribedSymbols: this.positionSubscriptions.size,
    };
  }

  // ============================================================================
  // Event Processing (Single Writer)
  // ============================================================================

  private triggerProcessing(): void {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    this.processingPromise = this.processEvents().finally(() => {
      this.isProcessing = false;
    });
  }

  private async processEvents(): Promise<void> {
    while (!this.eventQueue.isEmpty()) {
      const startTime = performance.now();
      
      // Micro-batching: collect events within window
      this.microBatchBuffer = [];
      this.microBatchStartTime = startTime;
      
      while (!this.eventQueue.isEmpty()) {
        const event = this.eventQueue.dequeue();
        if (!event) break;
        
        this.microBatchBuffer.push(event);
        
        // Check if micro-batch window exceeded
        if (performance.now() - this.microBatchStartTime > this.config.microBatchWindowMs) {
          break;
        }
      }

      // Process micro-batch
      for (const event of this.microBatchBuffer) {
        this.processEvent(event);
      }

      // Update TPS counter
      this.updateTpsCounter();

      // Yield to event loop occasionally
      if (this.ticksProcessed % 100 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  }

  private processEvent(event: MarketEvent): void {
    const startTime = performance.now();

    switch (event.type) {
      case 'price_tick':
        this.handlePriceTick(event as PriceTickEvent);
        break;
      case 'orderbook_update':
        this.handleOrderBookUpdate(event as OrderBookEvent);
        break;
      case 'funding_rate':
        this.handleFundingRate(event);
        break;
      case 'liquidation':
        this.handleLiquidation(event);
        break;
      default:
        // Handle other event types
        break;
    }

    // Update metrics
    const latency = performance.now() - startTime;
    this.ticksProcessed++;
    this.totalLatency += latency;
    if (latency > this.maxLatency) {
      this.maxLatency = latency;
    }
    this.lastSecondTicks++;
  }

  private handlePriceTick(event: PriceTickEvent): void {
    const { symbol, data, timestamp, sequenceId } = event;
    const { price, bid, ask } = data;

    // Update state (single writer)
    this.currentState.prices.set(symbol, price);
    this.currentState.timestamp = timestamp;
    this.currentState.sequenceId = sequenceId;

    // Get positions subscribed to this symbol (no looping over all positions)
    const subscribedPositions = this.positionSubscriptions.get(symbol);
    if (!subscribedPositions || subscribedPositions.size === 0) return;

    // Process only relevant positions
    const actions: PositionAction[] = [];
    
    for (const positionId of subscribedPositions) {
      const position = this.positions.get(positionId);
      if (!position) continue;

      // Update position state
      this.updatePositionOnTick(position, price, bid, ask);

      // Evaluate position and determine actions
      const action = this.evaluatePosition(position);
      if (action) {
        actions.push(action);
      }
    }

    // Emit actions for execution
    if (actions.length > 0) {
      this.emit('position_actions', { actions, timestamp });
    }
  }

  private updatePositionOnTick(
    position: PositionState,
    price: number,
    bid: number,
    ask: number
  ): void {
    const prevPrice = position.currentPrice;
    position.currentPrice = price;
    position.lastUpdateTime = performance.now();
    position.ticksProcessed++;

    // Calculate P&L
    const priceDiff = position.side === 'long'
      ? price - position.entryPrice
      : position.entryPrice - price;
    position.unrealizedPnL = priceDiff * position.quantity;
    position.unrealizedPnLPercent = (priceDiff / position.entryPrice) * 100;

    // Update high/low water marks
    if (price > position.highWaterMark) {
      position.highWaterMark = price;
      // Update trailing stop on new high
      if (position.side === 'long') {
        position.trailingStop = this.calculateTrailingStop('long', price);
      }
    }
    if (price < position.lowWaterMark) {
      position.lowWaterMark = price;
      // Update trailing stop on new low
      if (position.side === 'short') {
        position.trailingStop = this.calculateTrailingStop('short', price);
      }
    }

    // Calculate drawdown
    if (position.side === 'long') {
      position.drawdown = ((position.highWaterMark - price) / position.highWaterMark) * 100;
    } else {
      position.drawdown = ((price - position.lowWaterMark) / position.lowWaterMark) * 100;
    }

    // Calculate deviation from expected path
    // Expected path: linear interpolation from entry to take profit
    const timeElapsed = performance.now() - position.entryTime;
    const expectedMove = position.side === 'long' ? 0.001 : -0.001; // Expected 0.1% move per second
    position.expectedPath = position.entryPrice * (1 + expectedMove * (timeElapsed / 1000));
    position.deviation = Math.abs((price - position.expectedPath) / position.expectedPath);

    // Update snapshot
    this.currentState.positions.set(position.id, { ...position });
  }

  private evaluatePosition(position: PositionState): PositionAction | null {
    // Check stop loss
    if (position.stopLoss !== null) {
      if (position.side === 'long' && position.currentPrice <= position.stopLoss) {
        return {
          type: 'exit',
          positionId: position.id,
          symbol: position.symbol,
          reason: `Stop loss hit at ${position.currentPrice}`,
          urgency: 'immediate',
        };
      }
      if (position.side === 'short' && position.currentPrice >= position.stopLoss) {
        return {
          type: 'exit',
          positionId: position.id,
          symbol: position.symbol,
          reason: `Stop loss hit at ${position.currentPrice}`,
          urgency: 'immediate',
        };
      }
    }

    // Check trailing stop
    if (position.trailingStop !== null) {
      if (position.side === 'long' && position.currentPrice <= position.trailingStop) {
        return {
          type: 'exit',
          positionId: position.id,
          symbol: position.symbol,
          reason: `Trailing stop hit at ${position.currentPrice}`,
          urgency: 'immediate',
        };
      }
      if (position.side === 'short' && position.currentPrice >= position.trailingStop) {
        return {
          type: 'exit',
          positionId: position.id,
          symbol: position.symbol,
          reason: `Trailing stop hit at ${position.currentPrice}`,
          urgency: 'immediate',
        };
      }
    }

    // Check take profit
    if (position.takeProfit !== null) {
      if (position.side === 'long' && position.currentPrice >= position.takeProfit) {
        return {
          type: 'take_profit',
          positionId: position.id,
          symbol: position.symbol,
          reason: `Take profit hit at ${position.currentPrice}`,
          urgency: 'immediate',
        };
      }
      if (position.side === 'short' && position.currentPrice <= position.takeProfit) {
        return {
          type: 'take_profit',
          positionId: position.id,
          symbol: position.symbol,
          reason: `Take profit hit at ${position.currentPrice}`,
          urgency: 'immediate',
        };
      }
    }

    // Check max drawdown
    if (position.drawdown >= this.config.maxDrawdownPercent) {
      return {
        type: 'exit',
        positionId: position.id,
        symbol: position.symbol,
        reason: `Max drawdown exceeded: ${position.drawdown.toFixed(2)}%`,
        urgency: 'immediate',
      };
    }

    // Check deviation from expected path
    if (position.deviation > this.config.deviationTolerance) {
      // Price deviated significantly from expected path
      if (position.unrealizedPnLPercent < 0) {
        return {
          type: 'reduce',
          positionId: position.id,
          symbol: position.symbol,
          reason: `Price deviation ${(position.deviation * 100).toFixed(2)}% with negative P&L`,
          urgency: 'normal',
          params: { reducePercent: 50 },
        };
      }
    }

    return null;
  }

  private handleOrderBookUpdate(event: OrderBookEvent): void {
    const { symbol, data } = event;
    this.currentState.orderBooks.set(symbol, {
      bids: data.bids,
      asks: data.asks,
    });

    // Order book imbalance can trigger position adjustments
    if (Math.abs(data.imbalance) > 0.7) {
      const subscribedPositions = this.positionSubscriptions.get(symbol);
      if (subscribedPositions) {
        this.emit('orderbook_imbalance', {
          symbol,
          imbalance: data.imbalance,
          positionIds: Array.from(subscribedPositions),
        });
      }
    }
  }

  private handleFundingRate(event: MarketEvent): void {
    const { symbol, data } = event;
    this.currentState.fundingRates.set(symbol, data.rate);
    
    // High funding rates may warrant position adjustments
    if (Math.abs(data.rate) > 0.001) { // > 0.1%
      this.emit('high_funding_rate', { symbol, rate: data.rate });
    }
  }

  private handleLiquidation(event: MarketEvent): void {
    const { symbol, data } = event;
    
    // Large liquidations can signal market stress
    if (data.size > 1000000) { // > $1M liquidation
      this.emit('large_liquidation', {
        symbol,
        side: data.side,
        size: data.size,
        price: data.price,
      });
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private calculateTrailingStop(side: 'long' | 'short', price: number): number {
    const stopDistance = price * (this.config.trailingStopPercent / 100);
    return side === 'long' ? price - stopDistance : price + stopDistance;
  }

  private createEmptySnapshot(): StateSnapshot {
    return {
      timestamp: performance.now(),
      sequenceId: 0,
      prices: new Map(),
      positions: new Map(),
      orderBooks: new Map(),
      fundingRates: new Map(),
    };
  }

  private updateTpsCounter(): void {
    const now = performance.now();
    if (now - this.lastTpsUpdate >= 1000) {
      this.ticksPerSecond = this.lastSecondTicks;
      this.lastSecondTicks = 0;
      this.lastTpsUpdate = now;
    }
  }
}

// ============================================================================
// Event Priority Mapping
// ============================================================================

export const EVENT_PRIORITIES: Record<EventType, EventPriority> = {
  'price_tick': 1,      // Highest priority
  'orderbook_update': 1,
  'trade_print': 2,
  'liquidation': 2,
  'funding_rate': 3,
  'signal': 4,
  'news': 5,            // Lowest priority
};

// ============================================================================
// Factory Function
// ============================================================================

let engineInstance: EventDrivenPositionEngine | null = null;

export function getEventDrivenPositionEngine(
  config?: Partial<EngineConfig>
): EventDrivenPositionEngine {
  if (!engineInstance) {
    engineInstance = new EventDrivenPositionEngine(config);
  }
  return engineInstance;
}
