/**
 * Smart Order Router
 * 
 * Institutional-grade order execution with:
 * - TWAP (Time-Weighted Average Price) execution
 * - VWAP (Volume-Weighted Average Price) execution
 * - Iceberg order support
 * - Slippage protection
 * - Order retry with exponential backoff
 * - Execution quality analytics
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type OrderType = 'market' | 'limit' | 'twap' | 'vwap' | 'iceberg';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'pending' | 'active' | 'partial' | 'filled' | 'cancelled' | 'failed';

export interface SmartOrder {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  totalQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  limitPrice?: number;
  avgFillPrice: number;
  status: OrderStatus;
  slippage: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  config: OrderConfig;
  fills: OrderFill[];
  metrics: ExecutionMetrics;
}

export interface OrderConfig {
  // Common settings
  slippageTolerance: number; // Max allowed slippage %
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
  
  // TWAP settings
  twapDurationMinutes?: number;
  twapIntervalSeconds?: number;
  
  // VWAP settings
  vwapParticipationRate?: number; // % of volume to participate
  vwapMaxDeviation?: number; // Max deviation from VWAP
  
  // Iceberg settings
  icebergVisiblePercent?: number;
  icebergRandomization?: boolean;
}

export interface OrderFill {
  fillId: string;
  quantity: number;
  price: number;
  timestamp: Date;
  slippage: number;
  latencyMs: number;
}

export interface ExecutionMetrics {
  totalSlippage: number;
  avgSlippage: number;
  executionTime: number;
  fillCount: number;
  avgFillSize: number;
  priceImprovement: number;
  marketImpact: number;
  executionQualityScore: number; // 0-100
}

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  quantity: number;
  type: OrderType;
  limitPrice?: number;
  config?: Partial<OrderConfig>;
}

// ============================================================================
// Smart Order Router
// ============================================================================

export class SmartOrderRouter extends EventEmitter {
  private activeOrders: Map<string, SmartOrder> = new Map();
  private orderIntervals: Map<string, NodeJS.Timeout> = new Map();
  private priceProvider: (symbol: string) => number | undefined;
  private volumeProvider: (symbol: string) => number | undefined;

  constructor(
    priceProvider: (symbol: string) => number | undefined,
    volumeProvider?: (symbol: string) => number | undefined
  ) {
    super();
    this.priceProvider = priceProvider;
    this.volumeProvider = volumeProvider || (() => undefined);
  }

  // ============================================================================
  // Order Submission
  // ============================================================================

  async submitOrder(request: OrderRequest): Promise<SmartOrder> {
    const orderId = this.generateOrderId();
    const currentPrice = this.priceProvider(request.symbol);
    
    if (!currentPrice) {
      throw new Error(`No price available for ${request.symbol}`);
    }

    const config: OrderConfig = {
      slippageTolerance: 0.5,
      maxRetries: 3,
      retryDelayMs: 1000,
      timeoutMs: 30000,
      twapDurationMinutes: 5,
      twapIntervalSeconds: 30,
      vwapParticipationRate: 10,
      vwapMaxDeviation: 1,
      icebergVisiblePercent: 20,
      icebergRandomization: true,
      ...request.config,
    };

    const order: SmartOrder = {
      id: orderId,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      totalQuantity: request.quantity,
      filledQuantity: 0,
      remainingQuantity: request.quantity,
      limitPrice: request.limitPrice,
      avgFillPrice: 0,
      status: 'pending',
      slippage: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      config,
      fills: [],
      metrics: {
        totalSlippage: 0,
        avgSlippage: 0,
        executionTime: 0,
        fillCount: 0,
        avgFillSize: 0,
        priceImprovement: 0,
        marketImpact: 0,
        executionQualityScore: 100,
      },
    };

    this.activeOrders.set(orderId, order);

    // Execute based on order type
    switch (request.type) {
      case 'market':
        await this.executeMarketOrder(order);
        break;
      case 'limit':
        await this.executeLimitOrder(order);
        break;
      case 'twap':
        await this.executeTWAPOrder(order);
        break;
      case 'vwap':
        await this.executeVWAPOrder(order);
        break;
      case 'iceberg':
        await this.executeIcebergOrder(order);
        break;
    }

    return order;
  }

  // ============================================================================
  // Market Order Execution
  // ============================================================================

  private async executeMarketOrder(order: SmartOrder): Promise<void> {
    order.status = 'active';
    this.emit('order_active', order);

    const startTime = Date.now();
    let retryCount = 0;

    while (retryCount < order.config.maxRetries && order.remainingQuantity > 0) {
      try {
        const currentPrice = this.priceProvider(order.symbol);
        if (!currentPrice) {
          throw new Error('Price not available');
        }

        // Simulate slippage
        const slippagePercent = Math.random() * order.config.slippageTolerance;
        const slippageDirection = order.side === 'buy' ? 1 : -1;
        const fillPrice = currentPrice * (1 + (slippagePercent / 100) * slippageDirection);

        // Create fill
        const fill = this.createFill(order.remainingQuantity, fillPrice, currentPrice, startTime);
        order.fills.push(fill);

        // Update order state
        order.filledQuantity = order.totalQuantity;
        order.remainingQuantity = 0;
        order.avgFillPrice = fillPrice;
        order.slippage = slippagePercent;
        order.status = 'filled';
        order.completedAt = new Date();
        order.updatedAt = new Date();

        // Calculate metrics
        this.calculateMetrics(order, startTime);

        this.emit('order_filled', order);
        console.log(`[SmartOrderRouter] Market order ${order.id} filled at $${fillPrice.toFixed(2)} (slippage: ${slippagePercent.toFixed(3)}%)`);
        return;

      } catch (error: any) {
        retryCount++;
        console.warn(`[SmartOrderRouter] Market order retry ${retryCount}/${order.config.maxRetries}: ${error.message}`);
        
        if (retryCount < order.config.maxRetries) {
          await this.sleep(order.config.retryDelayMs * Math.pow(2, retryCount - 1));
        }
      }
    }

    // Failed after retries
    order.status = 'failed';
    order.updatedAt = new Date();
    this.emit('order_failed', order);
  }

  // ============================================================================
  // Limit Order Execution
  // ============================================================================

  private async executeLimitOrder(order: SmartOrder): Promise<void> {
    if (!order.limitPrice) {
      throw new Error('Limit price required for limit orders');
    }

    order.status = 'active';
    this.emit('order_active', order);

    const startTime = Date.now();
    const checkInterval = 1000; // Check every second
    
    const intervalId = setInterval(async () => {
      if (Date.now() - startTime > order.config.timeoutMs) {
        clearInterval(intervalId);
        this.orderIntervals.delete(order.id);
        
        if (order.filledQuantity > 0) {
          order.status = 'partial';
        } else {
          order.status = 'cancelled';
        }
        order.updatedAt = new Date();
        this.emit('order_timeout', order);
        return;
      }

      const currentPrice = this.priceProvider(order.symbol);
      if (!currentPrice) return;

      // Check if limit price is hit
      const limitHit = order.side === 'buy' 
        ? currentPrice <= order.limitPrice!
        : currentPrice >= order.limitPrice!;

      if (limitHit) {
        clearInterval(intervalId);
        this.orderIntervals.delete(order.id);

        // Execute at limit price or better
        const fillPrice = order.side === 'buy'
          ? Math.min(currentPrice, order.limitPrice!)
          : Math.max(currentPrice, order.limitPrice!);

        const fill = this.createFill(order.remainingQuantity, fillPrice, currentPrice, startTime);
        order.fills.push(fill);

        order.filledQuantity = order.totalQuantity;
        order.remainingQuantity = 0;
        order.avgFillPrice = fillPrice;
        order.status = 'filled';
        order.completedAt = new Date();
        order.updatedAt = new Date();

        this.calculateMetrics(order, startTime);
        this.emit('order_filled', order);
      }
    }, checkInterval);

    this.orderIntervals.set(order.id, intervalId);
  }

  // ============================================================================
  // TWAP Order Execution
  // ============================================================================

  private async executeTWAPOrder(order: SmartOrder): Promise<void> {
    order.status = 'active';
    this.emit('order_active', order);

    const startTime = Date.now();
    const durationMs = (order.config.twapDurationMinutes || 5) * 60 * 1000;
    const intervalMs = (order.config.twapIntervalSeconds || 30) * 1000;
    const numSlices = Math.ceil(durationMs / intervalMs);
    const sliceQuantity = order.totalQuantity / numSlices;

    let sliceCount = 0;

    const intervalId = setInterval(async () => {
      sliceCount++;
      
      const currentPrice = this.priceProvider(order.symbol);
      if (!currentPrice) {
        console.warn(`[SmartOrderRouter] TWAP slice ${sliceCount}: No price available`);
        return;
      }

      // Calculate slice with randomization (±10%)
      const randomFactor = 0.9 + Math.random() * 0.2;
      const actualSliceQuantity = Math.min(
        sliceQuantity * randomFactor,
        order.remainingQuantity
      );

      // Simulate slippage (reduced for TWAP)
      const slippagePercent = Math.random() * (order.config.slippageTolerance / 2);
      const slippageDirection = order.side === 'buy' ? 1 : -1;
      const fillPrice = currentPrice * (1 + (slippagePercent / 100) * slippageDirection);

      // Create fill
      const fill = this.createFill(actualSliceQuantity, fillPrice, currentPrice, startTime);
      order.fills.push(fill);

      // Update order state
      order.filledQuantity += actualSliceQuantity;
      order.remainingQuantity -= actualSliceQuantity;
      order.updatedAt = new Date();

      // Calculate running average price
      const totalValue = order.fills.reduce((sum, f) => sum + f.quantity * f.price, 0);
      order.avgFillPrice = totalValue / order.filledQuantity;

      this.emit('order_partial_fill', { order, fill, sliceCount, totalSlices: numSlices });
      console.log(`[SmartOrderRouter] TWAP slice ${sliceCount}/${numSlices}: ${actualSliceQuantity.toFixed(4)} @ $${fillPrice.toFixed(2)}`);

      // Check if complete
      if (order.remainingQuantity <= 0 || sliceCount >= numSlices) {
        clearInterval(intervalId);
        this.orderIntervals.delete(order.id);

        order.status = order.remainingQuantity <= 0 ? 'filled' : 'partial';
        order.completedAt = new Date();
        order.updatedAt = new Date();

        this.calculateMetrics(order, startTime);
        this.emit('order_filled', order);
      }
    }, intervalMs);

    this.orderIntervals.set(order.id, intervalId);
  }

  // ============================================================================
  // VWAP Order Execution
  // ============================================================================

  private async executeVWAPOrder(order: SmartOrder): Promise<void> {
    order.status = 'active';
    this.emit('order_active', order);

    const startTime = Date.now();
    const participationRate = (order.config.vwapParticipationRate || 10) / 100;
    const maxDeviation = order.config.vwapMaxDeviation || 1;
    const checkInterval = 5000; // Check every 5 seconds

    let cumulativeVolume = 0;
    let cumulativePriceVolume = 0;

    const intervalId = setInterval(async () => {
      if (Date.now() - startTime > order.config.timeoutMs) {
        clearInterval(intervalId);
        this.orderIntervals.delete(order.id);
        
        order.status = order.filledQuantity > 0 ? 'partial' : 'cancelled';
        order.completedAt = new Date();
        order.updatedAt = new Date();
        
        this.calculateMetrics(order, startTime);
        this.emit('order_timeout', order);
        return;
      }

      const currentPrice = this.priceProvider(order.symbol);
      const currentVolume = this.volumeProvider(order.symbol) || 1000; // Default volume
      
      if (!currentPrice) return;

      // Update VWAP calculation
      cumulativeVolume += currentVolume;
      cumulativePriceVolume += currentPrice * currentVolume;
      const vwap = cumulativePriceVolume / cumulativeVolume;

      // Check if current price is within acceptable deviation from VWAP
      const deviation = Math.abs((currentPrice - vwap) / vwap) * 100;
      
      if (deviation > maxDeviation) {
        console.log(`[SmartOrderRouter] VWAP: Price deviation ${deviation.toFixed(2)}% exceeds max ${maxDeviation}%, waiting...`);
        return;
      }

      // Calculate quantity based on participation rate
      const targetQuantity = currentVolume * participationRate;
      const actualQuantity = Math.min(targetQuantity, order.remainingQuantity);

      if (actualQuantity <= 0) return;

      // Execute slice
      const slippagePercent = Math.random() * (order.config.slippageTolerance / 3);
      const slippageDirection = order.side === 'buy' ? 1 : -1;
      const fillPrice = currentPrice * (1 + (slippagePercent / 100) * slippageDirection);

      const fill = this.createFill(actualQuantity, fillPrice, currentPrice, startTime);
      order.fills.push(fill);

      order.filledQuantity += actualQuantity;
      order.remainingQuantity -= actualQuantity;
      order.updatedAt = new Date();

      // Update average price
      const totalValue = order.fills.reduce((sum, f) => sum + f.quantity * f.price, 0);
      order.avgFillPrice = totalValue / order.filledQuantity;

      this.emit('order_partial_fill', { order, fill, vwap, deviation });
      console.log(`[SmartOrderRouter] VWAP fill: ${actualQuantity.toFixed(4)} @ $${fillPrice.toFixed(2)} (VWAP: $${vwap.toFixed(2)})`);

      // Check if complete
      if (order.remainingQuantity <= 0) {
        clearInterval(intervalId);
        this.orderIntervals.delete(order.id);

        order.status = 'filled';
        order.completedAt = new Date();
        order.updatedAt = new Date();

        this.calculateMetrics(order, startTime);
        this.emit('order_filled', order);
      }
    }, checkInterval);

    this.orderIntervals.set(order.id, intervalId);
  }

  // ============================================================================
  // Iceberg Order Execution
  // ============================================================================

  private async executeIcebergOrder(order: SmartOrder): Promise<void> {
    order.status = 'active';
    this.emit('order_active', order);

    const startTime = Date.now();
    const visiblePercent = (order.config.icebergVisiblePercent || 20) / 100;
    const baseSliceSize = order.totalQuantity * visiblePercent;
    const checkInterval = 2000; // Check every 2 seconds

    const intervalId = setInterval(async () => {
      if (Date.now() - startTime > order.config.timeoutMs) {
        clearInterval(intervalId);
        this.orderIntervals.delete(order.id);
        
        order.status = order.filledQuantity > 0 ? 'partial' : 'cancelled';
        order.completedAt = new Date();
        order.updatedAt = new Date();
        
        this.calculateMetrics(order, startTime);
        this.emit('order_timeout', order);
        return;
      }

      if (order.remainingQuantity <= 0) {
        clearInterval(intervalId);
        this.orderIntervals.delete(order.id);
        return;
      }

      const currentPrice = this.priceProvider(order.symbol);
      if (!currentPrice) return;

      // Calculate slice with randomization if enabled
      let sliceSize = baseSliceSize;
      if (order.config.icebergRandomization) {
        const randomFactor = 0.7 + Math.random() * 0.6; // 70% to 130%
        sliceSize = baseSliceSize * randomFactor;
      }
      sliceSize = Math.min(sliceSize, order.remainingQuantity);

      // Execute visible slice
      const slippagePercent = Math.random() * order.config.slippageTolerance;
      const slippageDirection = order.side === 'buy' ? 1 : -1;
      const fillPrice = currentPrice * (1 + (slippagePercent / 100) * slippageDirection);

      const fill = this.createFill(sliceSize, fillPrice, currentPrice, startTime);
      order.fills.push(fill);

      order.filledQuantity += sliceSize;
      order.remainingQuantity -= sliceSize;
      order.updatedAt = new Date();

      // Update average price
      const totalValue = order.fills.reduce((sum, f) => sum + f.quantity * f.price, 0);
      order.avgFillPrice = totalValue / order.filledQuantity;

      const hiddenRemaining = order.remainingQuantity;
      this.emit('order_partial_fill', { order, fill, hiddenRemaining });
      console.log(`[SmartOrderRouter] Iceberg fill: ${sliceSize.toFixed(4)} @ $${fillPrice.toFixed(2)} (hidden: ${hiddenRemaining.toFixed(4)})`);

      // Check if complete
      if (order.remainingQuantity <= 0) {
        clearInterval(intervalId);
        this.orderIntervals.delete(order.id);

        order.status = 'filled';
        order.completedAt = new Date();
        order.updatedAt = new Date();

        this.calculateMetrics(order, startTime);
        this.emit('order_filled', order);
      }
    }, checkInterval);

    this.orderIntervals.set(order.id, intervalId);
  }

  // ============================================================================
  // Order Management
  // ============================================================================

  cancelOrder(orderId: string): boolean {
    const order = this.activeOrders.get(orderId);
    if (!order) return false;

    // Clear any running intervals
    const intervalId = this.orderIntervals.get(orderId);
    if (intervalId) {
      clearInterval(intervalId);
      this.orderIntervals.delete(orderId);
    }

    order.status = order.filledQuantity > 0 ? 'partial' : 'cancelled';
    order.updatedAt = new Date();
    
    this.emit('order_cancelled', order);
    return true;
  }

  getOrder(orderId: string): SmartOrder | undefined {
    return this.activeOrders.get(orderId);
  }

  getActiveOrders(): SmartOrder[] {
    return Array.from(this.activeOrders.values()).filter(o => 
      o.status === 'pending' || o.status === 'active' || o.status === 'partial'
    );
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private generateOrderId(): string {
    return `ord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private createFill(
    quantity: number,
    fillPrice: number,
    marketPrice: number,
    startTime: number
  ): OrderFill {
    const slippage = ((fillPrice - marketPrice) / marketPrice) * 100;
    
    return {
      fillId: `fill_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      quantity,
      price: fillPrice,
      timestamp: new Date(),
      slippage: Math.abs(slippage),
      latencyMs: Date.now() - startTime,
    };
  }

  private calculateMetrics(order: SmartOrder, startTime: number): void {
    const fills = order.fills;
    if (fills.length === 0) return;

    const totalSlippage = fills.reduce((sum, f) => sum + f.slippage * f.quantity, 0);
    const avgSlippage = totalSlippage / order.filledQuantity;
    const executionTime = Date.now() - startTime;
    const avgFillSize = order.filledQuantity / fills.length;

    // Calculate price improvement (for limit orders)
    let priceImprovement = 0;
    if (order.limitPrice) {
      priceImprovement = order.side === 'buy'
        ? ((order.limitPrice - order.avgFillPrice) / order.limitPrice) * 100
        : ((order.avgFillPrice - order.limitPrice) / order.limitPrice) * 100;
    }

    // Estimate market impact (simplified)
    const marketImpact = avgSlippage * 0.5;

    // Calculate execution quality score
    let qualityScore = 100;
    qualityScore -= avgSlippage * 10; // Deduct for slippage
    qualityScore -= Math.min(20, executionTime / 10000); // Deduct for slow execution
    qualityScore += priceImprovement * 5; // Bonus for price improvement
    qualityScore = Math.max(0, Math.min(100, qualityScore));

    order.metrics = {
      totalSlippage,
      avgSlippage,
      executionTime,
      fillCount: fills.length,
      avgFillSize,
      priceImprovement,
      marketImpact,
      executionQualityScore: qualityScore,
    };

    order.slippage = avgSlippage;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createSmartOrderRouter(
  priceProvider: (symbol: string) => number | undefined,
  volumeProvider?: (symbol: string) => number | undefined
): SmartOrderRouter {
  return new SmartOrderRouter(priceProvider, volumeProvider);
}
