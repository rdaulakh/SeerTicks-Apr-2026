import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';
import { ExchangeInterface } from "../exchanges/ExchangeInterface";
import { getHotPath, HotPathEvents } from "../hotpath";

/**
 * Order Flow Analyst Agent
 * Analyzes order book imbalance and detects whale activity
 * 
 * Real-Time Integration:
 * - Subscribes to Hot Path for order book updates
 * - Processes every order book snapshot
 * - Emits signals on significant imbalance changes
 * 
 * Analysis:
 * - Bid/ask volume ratio
 * - Order book depth
 * - Large order detection (whales)
 * - Support/resistance from order clusters
 * - Order flow direction
 */

interface OrderBookSnapshot {
  symbol: string;
  bids: [number, number][]; // [price, volume]
  asks: [number, number][];
  timestamp: number;
}

interface OrderFlowMetrics {
  bidVolume: number;
  askVolume: number;
  imbalance: number; // bidVolume / askVolume
  largeOrders: { side: "bid" | "ask"; price: number; volume: number }[];
  supportLevels: number[];
  resistanceLevels: number[];
  // A+ Grade Institutional Metrics
  bidAskRatio: number;           // bidVolume / askVolume
  depthImbalance: number;        // (bidVolume - askVolume) / (bidVolume + askVolume)
  weightedImbalance: number;     // Weighted by distance from mid-price
  cumulativeVolumeDelta: number; // CVD tracking
  icebergOrders: IcebergOrder[]; // Detected hidden orders
  orderBookScore: number;        // -100 to +100 composite score
}

interface IcebergOrder {
  side: 'bid' | 'ask';
  priceLevel: number;
  estimatedSize: number;
  refillCount: number;
  confidence: number;
}

export class OrderFlowAnalyst extends AgentBase {
  private exchange: ExchangeInterface | null = null;
  private hotPath: ReturnType<typeof getHotPath> | null = null;
  private latestOrderBook: Map<string, OrderBookSnapshot> = new Map();
  private readonly LARGE_ORDER_THRESHOLD = 10; // 10x average order size
  
  // A+ Grade: CVD and Iceberg tracking
  private cvdHistory: Map<string, number[]> = new Map(); // Symbol -> CVD values
  private orderRefills: Map<string, Map<number, number>> = new Map(); // Symbol -> Price -> Refill count
  private previousOrderBook: Map<string, OrderBookSnapshot> = new Map();
  
  // A++ Grade: Live price injection for dynamic confidence
  private currentPrice: number = 0;

  constructor(config?: Partial<AgentConfig>) {
    super({
      name: "OrderFlowAnalyst",
      enabled: true,
      updateInterval: 0, // Real-time, event-driven
      timeout: 5000,
      maxRetries: 2,
      ...config,
    });
  }

  /**
   * Set the exchange adapter for market data
   */
  setExchange(exchange: ExchangeInterface): void {
    this.exchange = exchange;
  }

  /**
   * A++ Grade: Set current price for dynamic confidence calculation
   * Called by SymbolOrchestrator before each fast agent analysis
   */
  setCurrentPrice(price: number): void {
    this.currentPrice = price;
  }

  protected async initialize(): Promise<void> {
    console.log(`[${this.config.name}] Initializing order flow monitoring...`);
    
    // Subscribe to Hot Path events
    this.hotPath = getHotPath();
    
    // Listen for tick events (which include order book data)
    this.hotPath.on(HotPathEvents.TICK_PROCESSED, (data: any) => {
      if (data.orderBook) {
        this.updateOrderBook(data.symbol, data.orderBook);
      }
    });
  }

  protected async cleanup(): Promise<void> {
    this.latestOrderBook.clear();
  }

  protected async analyze(symbol: string, context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();

    try {
      // Try to get order book from cache first (populated by Hot Path)
      let orderBook = this.latestOrderBook.get(symbol);

      // Phase 11 Fix 3: REMOVED REST API fallback — OrderFlowAnalyst is a FAST agent
      // called on every tick. REST API calls (100-500ms each) on the hot path caused
      // the 67-second signal collection time (2,200x over target).
      // The order book cache is populated by the Hot Path WebSocket events above.
      // If no cached data exists, return neutral signal (don't block the tick pipeline).

      if (!orderBook) {
        return this.createNeutralSignal(symbol, "No order book data available");
      }

      // Calculate order flow metrics
      const metrics = this.calculateOrderFlowMetrics(orderBook);

      // Analyze using LLM (optional for this agent, mostly rule-based)
      const analysis = await this.analyzeOrderFlow(symbol, metrics);

      // Calculate base signal
      const { signal, confidence: baseConfidence, strength, reasoning } = this.calculateSignalFromOrderFlow(
        metrics,
        analysis
      );
      
      // A++ Grade: Apply dynamic confidence adjustment based on live price
      const priceAdjustment = this.calculatePriceDeviationAdjustment(metrics, this.currentPrice);
      // Phase 94.6 — RESURRECT Phase 93.25's silent-neutral 0.02 floor.
      // The original Phase 93.25 fix set `confidence = 0.02` for the neutral
      // branch of calculateSignalFromOrderFlow (line ~383). It was clobbered
      // here by `Math.max(0.1, ...)` — re-floored to 0.1 on EVERY signal
      // including neutrals. Forensic audit (Stream A, 2026-05-15) caught this:
      // a phantom-neutral conf 0.1 dilutes the active-directional corpus that
      // Phase 94.2's presence-formula denominator depends on. Only re-floor
      // to 0.1 when the signal is directional; neutrals stay at 0.02.
      const minFloor = signal === 'neutral' ? 0.02 : 0.1;
      let confidence = Math.max(minFloor, Math.min(0.99, baseConfidence + priceAdjustment));

      // Phase 30: Apply MarketContext regime adjustments
      if (context?.regime) {
        const regime = context.regime as string;
        // In high volatility: order flow is CRITICAL — boost confidence for strong signals
        if (regime === 'high_volatility' && Math.abs(metrics.imbalance) > 0.3) {
          confidence = Math.min(0.95, confidence * 1.15);
        }
        // In breakout: order flow confirmation is essential
        if (regime === 'breakout' && Math.abs(metrics.imbalance) > 0.2) {
          confidence = Math.min(0.95, confidence * 1.10);
        }
        // In range-bound: order flow near boundaries matters more
        if (regime === 'range_bound') {
          confidence *= 0.9; // Slightly reduce in choppy markets
        }
      }
      
      // Phase 33: Incorporate task-specific questions from MarketRegimeAI
      let enrichedReasoning = reasoning;
      if (context?.taskQuestions?.length > 0) {
        const taskAnswers: string[] = [];
        for (const question of context.taskQuestions as string[]) {
          const q = question.toLowerCase();
          if (q.includes('absorption') || q.includes('wall')) {
            const largeWalls = metrics.largeOrders.filter(o => o.volume > metrics.bidVolume * 0.1);
            taskAnswers.push(`${largeWalls.length} significant order walls detected`);
          } else if (q.includes('iceberg') || q.includes('hidden')) {
            taskAnswers.push(`Order book score: ${metrics.orderBookScore.toFixed(0)} (includes iceberg detection)`);
          } else if (q.includes('imbalance') || q.includes('pressure')) {
            taskAnswers.push(`Depth imbalance: ${(metrics.imbalance * 100).toFixed(1)}%, Bid/Ask ratio: ${(metrics.bidVolume / Math.max(metrics.askVolume, 1)).toFixed(2)}`);
          } else if (q.includes('liquidation') || q.includes('cluster')) {
            taskAnswers.push(`Support clusters: ${metrics.supportLevels.slice(0, 2).map((l: number) => '$' + l.toFixed(0)).join(', ')}, Resistance: ${metrics.resistanceLevels.slice(0, 2).map((l: number) => '$' + l.toFixed(0)).join(', ')}`);
          } else if (q.includes('whale') || q.includes('institutional')) {
            taskAnswers.push(`Large orders: ${metrics.largeOrders.length} detected (${metrics.largeOrders.filter(o => o.side === 'bid').length} bid, ${metrics.largeOrders.filter(o => o.side === 'ask').length} ask)`);
          }
        }
        if (taskAnswers.length > 0) {
          enrichedReasoning += ` [Task Analysis: ${taskAnswers.join('; ')}]`;
        }
      }
      if (context?.taskFocus) {
        enrichedReasoning += ` [Focus: ${context.taskFocus}]`;
      }

      // A++ Grade: Calculate execution score (0-100) for order flow timing quality
      const executionScore = this.calculateExecutionScore(metrics, this.currentPrice, orderBook);

      const processingTime = getActiveClock().now() - startTime;
      const dataFreshness = (getActiveClock().now() - orderBook.timestamp) / 1000;

      return {
        agentName: this.config.name,
        symbol,
        timestamp: getActiveClock().now(),
        signal,
        confidence,
        strength,
        reasoning: enrichedReasoning,
        evidence: {
          bidVolume: metrics.bidVolume,
          askVolume: metrics.askVolume,
          imbalance: metrics.imbalance,
          orderBookScore: metrics.orderBookScore, // A+ Grade: Composite score (-100 to +100)
          largeOrdersCount: metrics.largeOrders.length,
          largeOrders: metrics.largeOrders.slice(0, 5),
          supportLevels: metrics.supportLevels.slice(0, 3),
          resistanceLevels: metrics.resistanceLevels.slice(0, 3),
          executionScore, // A++ Grade: Execution timing quality (0-100)
        },
        executionScore, // Add at top level for AgentSignal type compliance
        qualityScore: this.calculateQualityScore(orderBook, dataFreshness),
        processingTime,
        dataFreshness,
        recommendation: this.getRecommendation(signal, confidence, strength, metrics),
      };
    } catch (error) {
      console.error(`[${this.config.name}] Analysis failed:`, error);
      return this.createNeutralSignal(symbol, `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  protected async periodicUpdate(): Promise<void> {
    // Not used for this agent (real-time, event-driven)
  }

  /**
   * Update order book snapshot
   */
  public updateOrderBook(symbol: string, orderBook: any): void {
    this.latestOrderBook.set(symbol, {
      symbol,
      bids: orderBook.bids || [],
      asks: orderBook.asks || [],
      timestamp: getActiveClock().now(),
    });
  }

  /**
   * Calculate order flow metrics (A+ Grade: Enhanced with institutional metrics)
   */
  private calculateOrderFlowMetrics(orderBook: OrderBookSnapshot): OrderFlowMetrics {
    // Calculate total bid and ask volume (top 10 levels for depth analysis)
    const topLevels = 10;
    const bidVolume = orderBook.bids.slice(0, topLevels).reduce((sum, [_, vol]) => sum + vol, 0);
    const askVolume = orderBook.asks.slice(0, topLevels).reduce((sum, [_, vol]) => sum + vol, 0);

    // Basic imbalance (legacy)
    const imbalance = askVolume > 0 ? bidVolume / askVolume : 0;

    // A+ Grade: Bid/Ask Ratio
    const bidAskRatio = askVolume > 0 ? bidVolume / askVolume : 1.0;

    // A+ Grade: Depth Imbalance (-1 to +1)
    const totalVolume = bidVolume + askVolume;
    const depthImbalance = totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0;

    // A+ Grade: Weighted Imbalance (closer levels weighted more heavily)
    const weightedImbalance = this.calculateWeightedImbalance(orderBook);

    // A+ Grade: Cumulative Volume Delta (CVD)
    const cumulativeVolumeDelta = this.updateCVD(orderBook.symbol, bidVolume, askVolume);

    // A+ Grade: Iceberg Order Detection
    const icebergOrders = this.detectIcebergOrders(orderBook);

    // A+ Grade: Composite Order Book Score (-100 to +100)
    const orderBookScore = this.calculateOrderBookScore(
      bidAskRatio,
      depthImbalance,
      weightedImbalance,
      icebergOrders
    );
    
    // DEBUG: Log order book metrics
    console.log(`[OrderFlowAnalyst] ${orderBook.symbol} Metrics: bidVol=${bidVolume.toFixed(2)}, askVol=${askVolume.toFixed(2)}, ratio=${bidAskRatio.toFixed(2)}, depthImb=${depthImbalance.toFixed(2)}, weightedImb=${weightedImbalance.toFixed(2)}, score=${orderBookScore.toFixed(0)}`);

    // Detect large orders
    const avgBidSize = bidVolume / Math.max(orderBook.bids.length, 1);
    const avgAskSize = askVolume / Math.max(orderBook.asks.length, 1);
    const largeOrders: OrderFlowMetrics["largeOrders"] = [];

    for (const [price, volume] of orderBook.bids) {
      if (volume > avgBidSize * this.LARGE_ORDER_THRESHOLD) {
        largeOrders.push({ side: "bid", price, volume });
      }
    }

    for (const [price, volume] of orderBook.asks) {
      if (volume > avgAskSize * this.LARGE_ORDER_THRESHOLD) {
        largeOrders.push({ side: "ask", price, volume });
      }
    }

    // Identify support/resistance from order clusters
    const supportLevels = this.findOrderClusters(orderBook.bids, "support");
    const resistanceLevels = this.findOrderClusters(orderBook.asks, "resistance");

    return {
      bidVolume,
      askVolume,
      imbalance,
      largeOrders,
      supportLevels,
      resistanceLevels,
      // A+ Grade metrics
      bidAskRatio,
      depthImbalance,
      weightedImbalance,
      cumulativeVolumeDelta,
      icebergOrders,
      orderBookScore,
    };
  }

  /**
   * Find price levels with clustered orders (support/resistance)
   */
  private findOrderClusters(
    orders: [number, number][],
    type: "support" | "resistance"
  ): number[] {
    if (orders.length === 0) return [];

    // Group orders by price buckets (0.1% intervals)
    const buckets = new Map<number, number>();

    for (const [price, volume] of orders) {
      const bucket = Math.floor(price * 1000) / 1000; // Round to 3 decimals
      buckets.set(bucket, (buckets.get(bucket) || 0) + volume);
    }

    // Find top 5 clusters by volume
    const clusters = Array.from(buckets.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([price]) => price);

    return type === "support" ? clusters.sort((a, b) => b - a) : clusters.sort((a, b) => a - b);
  }

  /**
   * Analyze order flow using LLM (optional, mostly rule-based)
   */
  private async analyzeOrderFlow(symbol: string, metrics: OrderFlowMetrics): Promise<string> {
    // For Order Flow, we mostly use rule-based analysis
    // LLM can provide context but is not critical

    if (metrics.largeOrders.length === 0) {
      return "No significant whale activity detected.";
    }

    const largeBids = metrics.largeOrders.filter(o => o.side === "bid").length;
    const largeAsks = metrics.largeOrders.filter(o => o.side === "ask").length;

    if (largeBids > largeAsks) {
      return `Detected ${largeBids} large buy orders vs ${largeAsks} sell orders. Whales accumulating.`;
    } else if (largeAsks > largeBids) {
      return `Detected ${largeAsks} large sell orders vs ${largeBids} buy orders. Whales distributing.`;
    } else {
      return `Balanced whale activity: ${largeBids} large orders on each side.`;
    }
  }

  /**
   * Calculate signal from order flow (A+ Grade: Enhanced with order book score)
   */
  private calculateSignalFromOrderFlow(
    metrics: OrderFlowMetrics,
    analysis: string
  ): {
    signal: "bullish" | "bearish" | "neutral";
    confidence: number;
    strength: number;
    reasoning: string;
  } {
    let signal: "bullish" | "bearish" | "neutral" = "neutral";
    // Phase 93.25 — silent-neutral demotion (was 0.5 phantom-vote bug). See attribution audit 2026-05-15.
    // Initial value is the neutral fallback (|score| ≤ 20). All directional branches below reassign confidence.
    let confidence = 0.02;
    let strength = 0.5;

    // A+ Grade: Use composite order book score as primary signal
    const score = metrics.orderBookScore;
    
    if (score > 50) {
      // Strong bullish order book
      signal = "bullish";
      confidence = Math.min(0.5 + (score / 200), 0.9); // 50-90% confidence
      strength = Math.min(score / 100, 1.0);
    } else if (score < -50) {
      // Strong bearish order book
      signal = "bearish";
      confidence = Math.min(0.5 + (Math.abs(score) / 200), 0.9);
      strength = Math.min(Math.abs(score) / 100, 1.0);
    } else if (score > 20) {
      signal = "bullish";
      confidence = 0.5 + (score / 250);
      strength = score / 150;
    } else if (score < -20) {
      signal = "bearish";
      confidence = 0.5 + (Math.abs(score) / 250);
      strength = Math.abs(score) / 150;
    }

    // Large order analysis (boost confidence)
    const largeBids = metrics.largeOrders.filter(o => o.side === "bid").length;
    const largeAsks = metrics.largeOrders.filter(o => o.side === "ask").length;

    if (largeBids > largeAsks + 2) {
      // Whales buying
      if (signal === "bullish") {
        confidence = Math.min(confidence + 0.1, 0.95);
        strength = Math.min(strength + 0.15, 1.0);
      }
    } else if (largeAsks > largeBids + 2) {
      // Whales selling
      if (signal === "bearish") {
        confidence = Math.min(confidence + 0.1, 0.95);
        strength = Math.min(strength + 0.15, 1.0);
      }
    }

    // A+ Grade: Enhanced reasoning with institutional metrics
    const icebergInfo = metrics.icebergOrders.length > 0 
      ? ` ${metrics.icebergOrders.length} iceberg order(s) detected.`
      : '';
    
    const reasoning = `Order book score: ${score.toFixed(0)}/100. Depth imbalance: ${(metrics.depthImbalance * 100).toFixed(1)}%. Weighted imbalance: ${(metrics.weightedImbalance * 100).toFixed(1)}%. CVD: ${metrics.cumulativeVolumeDelta.toFixed(0)}.${icebergInfo} ${metrics.largeOrders.length} large orders (${largeBids} bids, ${largeAsks} asks). ${analysis}`;

    // DEBUG: Log signal calculation result
    console.log(`[OrderFlowAnalyst] Signal calculation: score=${score.toFixed(0)}, signal=${signal}, confidence=${confidence.toFixed(2)}, strength=${strength.toFixed(2)}`);
    
    return { signal, confidence, strength, reasoning };
  }

  /**
   * Calculate quality score
   */
  private calculateQualityScore(orderBook: OrderBookSnapshot, dataFreshness: number): number {
    const depthScore = Math.min((orderBook.bids.length + orderBook.asks.length) / 100, 1.0);
    const freshnessScore = Math.max(1 - (dataFreshness / 10), 0); // Decay over 10 seconds
    const balanceScore = orderBook.bids.length > 0 && orderBook.asks.length > 0 ? 1.0 : 0.5;

    return (depthScore * 0.4 + freshnessScore * 0.4 + balanceScore * 0.2);
  }

  /**
   * Get recommendation
   */
  private getRecommendation(
    signal: "bullish" | "bearish" | "neutral",
    confidence: number,
    strength: number,
    metrics: OrderFlowMetrics
  ): AgentSignal["recommendation"] {
    if (signal === "neutral" || confidence < 0.6) {
      return {
        action: "hold",
        urgency: "low",
      };
    }

    // Higher urgency for extreme imbalances
    const urgency = metrics.imbalance > 2.0 || metrics.imbalance < 0.5 ? "high" : strength > 0.7 ? "medium" : "low";

    if (signal === "bullish") {
      return {
        action: confidence > 0.7 ? "buy" : "hold",
        urgency,
        targetPrice: metrics.resistanceLevels[0],
        stopLoss: metrics.supportLevels[0],
      };
    } else {
      return {
        action: confidence > 0.7 ? "sell" : "reduce",
        urgency,
        targetPrice: metrics.supportLevels[0],
        stopLoss: metrics.resistanceLevels[0],
      };
    }
  }

  /**
   * A+ Grade: Calculate weighted imbalance (closer price levels weighted more)
   */
  private calculateWeightedImbalance(orderBook: OrderBookSnapshot): number {
    if (orderBook.bids.length === 0 || orderBook.asks.length === 0) return 0;

    // Calculate mid-price
    const bestBid = orderBook.bids[0][0];
    const bestAsk = orderBook.asks[0][0];
    const midPrice = (bestBid + bestAsk) / 2;

    let weightedBidVolume = 0;
    let weightedAskVolume = 0;

    // Weight orders by exponential decay based on distance from mid-price
    const decayFactor = 0.1; // 10% decay per 1% distance

    for (const [price, volume] of orderBook.bids.slice(0, 10)) {
      const distance = Math.abs(price - midPrice) / midPrice;
      const weight = Math.exp(-distance / decayFactor);
      weightedBidVolume += volume * weight;
    }

    for (const [price, volume] of orderBook.asks.slice(0, 10)) {
      const distance = Math.abs(price - midPrice) / midPrice;
      const weight = Math.exp(-distance / decayFactor);
      weightedAskVolume += volume * weight;
    }

    const totalWeighted = weightedBidVolume + weightedAskVolume;
    return totalWeighted > 0 ? (weightedBidVolume - weightedAskVolume) / totalWeighted : 0;
  }

  /**
   * A+ Grade: Update Cumulative Volume Delta (CVD)
   */
  private updateCVD(symbol: string, bidVolume: number, askVolume: number): number {
    // Get or initialize CVD history
    if (!this.cvdHistory.has(symbol)) {
      this.cvdHistory.set(symbol, [0]);
    }

    const history = this.cvdHistory.get(symbol)!;
    const previousCVD = history[history.length - 1] || 0;

    // CVD = previous CVD + (aggressive buy volume - aggressive sell volume)
    // Approximation: use bid/ask volume delta as proxy for aggressive trading
    const volumeDelta = bidVolume - askVolume;
    const newCVD = previousCVD + volumeDelta;

    // Store in history (keep last 100 values)
    history.push(newCVD);
    if (history.length > 100) {
      history.shift();
    }

    return newCVD;
  }

  /**
   * A+ Grade: Detect iceberg orders (hidden large orders)
   */
  private detectIcebergOrders(orderBook: OrderBookSnapshot): IcebergOrder[] {
    const icebergs: IcebergOrder[] = [];
    const symbol = orderBook.symbol;

    // Get previous order book for comparison
    const previous = this.previousOrderBook.get(symbol);
    if (!previous) {
      // Store current and return empty (need history)
      this.previousOrderBook.set(symbol, orderBook);
      return [];
    }

    // Initialize refill tracking
    if (!this.orderRefills.has(symbol)) {
      this.orderRefills.set(symbol, new Map());
    }
    const refills = this.orderRefills.get(symbol)!;

    // Check bids for refills
    for (const [price, volume] of orderBook.bids.slice(0, 20)) {
      const previousOrder = previous.bids.find(([p]) => Math.abs(p - price) < price * 0.0001);
      
      if (previousOrder) {
        const [prevPrice, prevVolume] = previousOrder;
        
        // Detect refill: volume increased at same price level
        if (volume > prevVolume * 1.5) {
          const currentRefills = refills.get(price) || 0;
          refills.set(price, currentRefills + 1);

          // Iceberg detected if refilled 3+ times
          if (currentRefills >= 2) {
            icebergs.push({
              side: 'bid',
              priceLevel: price,
              estimatedSize: volume * (currentRefills + 1), // Estimate total hidden size
              refillCount: currentRefills + 1,
              confidence: Math.min(currentRefills / 5, 0.95)
            });
          }
        }
      }
    }

    // Check asks for refills
    for (const [price, volume] of orderBook.asks.slice(0, 20)) {
      const previousOrder = previous.asks.find(([p]) => Math.abs(p - price) < price * 0.0001);
      
      if (previousOrder) {
        const [prevPrice, prevVolume] = previousOrder;
        
        if (volume > prevVolume * 1.5) {
          const currentRefills = refills.get(price) || 0;
          refills.set(price, currentRefills + 1);

          if (currentRefills >= 2) {
            icebergs.push({
              side: 'ask',
              priceLevel: price,
              estimatedSize: volume * (currentRefills + 1),
              refillCount: currentRefills + 1,
              confidence: Math.min(currentRefills / 5, 0.95)
            });
          }
        }
      }
    }

    // Update previous order book
    this.previousOrderBook.set(symbol, orderBook);

    // Clean old refill data (keep only last 50 price levels)
    if (refills.size > 50) {
      const entries = Array.from(refills.entries());
      refills.clear();
      entries.slice(-50).forEach(([price, count]) => refills.set(price, count));
    }

    return icebergs;
  }

  /**
   * A+ Grade: Calculate composite order book score (-100 to +100)
   */
  private calculateOrderBookScore(
    bidAskRatio: number,
    depthImbalance: number,
    weightedImbalance: number,
    icebergOrders: IcebergOrder[]
  ): number {
    let score = 0;
    let ratioContrib = 0;

    // Component 1: Bid/Ask Ratio (weight: 30%)
    // bidAskRatio > 1.5 = bullish, < 0.67 = bearish
    if (bidAskRatio > 1.5) {
      ratioContrib = Math.min((bidAskRatio - 1) * 30, 30);
      score += ratioContrib;
    } else if (bidAskRatio < 0.67) {
      ratioContrib = -Math.min((1 - bidAskRatio) * 30, 30);
      score += ratioContrib;
    }

    // Component 2: Depth Imbalance (weight: 35%)
    // depthImbalance ranges from -1 to +1
    const depthContrib = depthImbalance * 35;
    score += depthContrib;

    // Component 3: Weighted Imbalance (weight: 25%)
    // weightedImbalance ranges from -1 to +1
    const weightedContrib = weightedImbalance * 25;
    score += weightedContrib;

    // Component 4: Iceberg Orders (weight: 10%)
    const bidIcebergs = icebergOrders.filter(i => i.side === 'bid').length;
    const askIcebergs = icebergOrders.filter(i => i.side === 'ask').length;
    let icebergContrib = 0;
    if (bidIcebergs > askIcebergs) {
      icebergContrib = (bidIcebergs - askIcebergs) * 5;
      score += icebergContrib;
    } else if (askIcebergs > bidIcebergs) {
      icebergContrib = -(askIcebergs - bidIcebergs) * 5;
      score += icebergContrib;
    }

    // DEBUG: Log score components
    console.log(`[OrderFlowAnalyst] Score breakdown: ratio=${ratioContrib.toFixed(1)}, depth=${depthContrib.toFixed(1)}, weighted=${weightedContrib.toFixed(1)}, iceberg=${icebergContrib}, total=${score.toFixed(1)}`);

    // Clamp to -100 to +100
    return Math.max(-100, Math.min(100, score));
  }

  /**
   * A++ Grade: Calculate dynamic confidence adjustment based on price deviation from order book levels
   * Returns adjustment value (-0.2 to +0.2) to add to base confidence
   */
  private calculatePriceDeviationAdjustment(
    metrics: OrderFlowMetrics,
    currentPrice: number
  ): number {
    if (!currentPrice || currentPrice === 0) return 0;
    if (metrics.supportLevels.length === 0 && metrics.resistanceLevels.length === 0) return 0;

    let adjustment = 0;

    // Factor 1: Distance from support/resistance levels (-0.1 to +0.1)
    const bestSupport = metrics.supportLevels[0];
    const bestResistance = metrics.resistanceLevels[0];

    if (bestSupport && bestResistance) {
      const range = bestResistance - bestSupport;
      const positionInRange = (currentPrice - bestSupport) / range;

      // Bullish signal: boost confidence when price near support
      if (metrics.orderBookScore > 20) {
        if (positionInRange < 0.3) {
          // Price near support = good buy opportunity
          adjustment += 0.1 * (1 - positionInRange / 0.3);
        }
      }
      // Bearish signal: boost confidence when price near resistance
      else if (metrics.orderBookScore < -20) {
        if (positionInRange > 0.7) {
          // Price near resistance = good sell opportunity
          adjustment += 0.1 * ((positionInRange - 0.7) / 0.3);
        }
      }
    }

    // Factor 2: Price momentum relative to order book (-0.1 to +0.1)
    // Check if price is moving toward or away from large orders
    const largeBuyOrders = metrics.largeOrders.filter(o => o.side === 'bid');
    const largeSellOrders = metrics.largeOrders.filter(o => o.side === 'ask');

    if (largeBuyOrders.length > 0) {
      const avgBuyPrice = largeBuyOrders.reduce((sum, o) => sum + o.price, 0) / largeBuyOrders.length;
      const distanceToBuys = Math.abs(currentPrice - avgBuyPrice) / currentPrice;

      // Bullish: boost if price approaching large buy orders
      if (metrics.orderBookScore > 20 && distanceToBuys < 0.02) {
        adjustment += 0.05 * (1 - distanceToBuys / 0.02);
      }
    }

    if (largeSellOrders.length > 0) {
      const avgSellPrice = largeSellOrders.reduce((sum, o) => sum + o.price, 0) / largeSellOrders.length;
      const distanceToSells = Math.abs(currentPrice - avgSellPrice) / currentPrice;

      // Bearish: boost if price approaching large sell orders
      if (metrics.orderBookScore < -20 && distanceToSells < 0.02) {
        adjustment += 0.05 * (1 - distanceToSells / 0.02);
      }
    }

    // Clamp adjustment to reasonable range
    return Math.max(-0.2, Math.min(0.2, adjustment));
  }

  /**
   * A++ Grade: Calculate execution score (0-100) for order flow timing quality
   * Assesses whether current market conditions are favorable for order execution
   */
  private calculateExecutionScore(
    metrics: OrderFlowMetrics,
    currentPrice: number,
    orderBook: OrderBookSnapshot
  ): number {
    let score = 0;

    // Component 1: Order Book Depth Quality (0-30 points)
    // Higher total volume = better liquidity = easier execution
    const totalVolume = metrics.bidVolume + metrics.askVolume;
    const depthScore = Math.min((totalVolume / 1000) * 30, 30);
    score += depthScore;

    // Component 2: Bid/Ask Spread Tightness (0-25 points)
    // Tighter spread = lower execution cost
    if (orderBook.bids.length > 0 && orderBook.asks.length > 0) {
      const bestBid = orderBook.bids[0][0];
      const bestAsk = orderBook.asks[0][0];
      const spread = (bestAsk - bestBid) / bestBid;
      const spreadBps = spread * 10000; // Convert to basis points
      
      // Excellent: <5 bps (25 pts), Good: 5-10 bps (15 pts), Fair: 10-20 bps (5 pts), Poor: >20 bps (0 pts)
      let spreadScore = 0;
      if (spreadBps < 5) {
        spreadScore = 25;
      } else if (spreadBps < 10) {
        spreadScore = 15;
      } else if (spreadBps < 20) {
        spreadScore = 5;
      }
      score += spreadScore;
    }

    // Component 3: Large Order Proximity (0-25 points)
    // Nearby large orders = potential support/resistance = better execution timing
    if (currentPrice > 0 && metrics.largeOrders.length > 0) {
      let proximityScore = 0;
      
      for (const largeOrder of metrics.largeOrders.slice(0, 10)) {
        const distance = Math.abs(largeOrder.price - currentPrice) / currentPrice;
        
        // Very close (<0.5%): 5 points, Close (0.5-1%): 3 points, Near (1-2%): 1 point
        if (distance < 0.005) {
          proximityScore += 5;
        } else if (distance < 0.01) {
          proximityScore += 3;
        } else if (distance < 0.02) {
          proximityScore += 1;
        }
      }
      
      score += Math.min(proximityScore, 25);
    }

    // Component 4: Volume Surge Detection (0-20 points)
    // Recent volume increase = market activity = better execution opportunity
    const cvdHistory = this.cvdHistory.get(orderBook.symbol) || [];
    if (cvdHistory.length >= 5) {
      const recentCVD = cvdHistory.slice(-5);
      const avgCVD = recentCVD.reduce((sum, v) => sum + Math.abs(v), 0) / recentCVD.length;
      const currentCVD = Math.abs(metrics.cumulativeVolumeDelta);
      
      // Volume surge: current CVD > 1.5x average
      if (currentCVD > avgCVD * 1.5) {
        score += 20;
      } else if (currentCVD > avgCVD * 1.2) {
        score += 10;
      } else if (currentCVD > avgCVD) {
        score += 5;
      }
    } else {
      // Not enough history, give neutral score
      score += 10;
    }

    // Clamp to 0-100
    return Math.max(0, Math.min(100, Math.round(score)));
  }
}
