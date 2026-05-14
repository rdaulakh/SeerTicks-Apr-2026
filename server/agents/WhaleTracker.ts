import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';
import { fetchWhaleAlerts, WhaleTransaction } from "../services/whaleAlertService";
import { fallbackManager, MarketDataInput } from "./DeterministicFallback";
import { getAggregatedWhaleData, getWhaleSignalFromAggregated } from "../services/MultiSourceWhaleService";
import { IcebergOrderDetector, Trade, IcebergPattern, IcebergSignal } from "../services/IcebergOrderDetector";
import { engineLogger } from "../utils/logger";

/**
 * WhaleTracker Agent - Phase 2 Implementation
 * 
 * Monitors large cryptocurrency transactions (whale movements) to detect
 * potential market-moving activity before it impacts prices.
 * 
 * Features:
 * - Real-time whale transaction monitoring via Whale Alert API
 * - Exchange flow analysis (inflow = selling pressure, outflow = accumulation)
 * - Large transaction pattern detection
 * - Deterministic fallback when API unavailable
 * 
 * Signal Logic:
 * - Large exchange inflows → Bearish (whales preparing to sell)
 * - Large exchange outflows → Bullish (whales accumulating)
 * - Burn events → Bullish (supply reduction)
 * - Mint events → Bearish (supply increase)
 */

interface WhaleAnalysis {
  totalVolume24h: number;
  exchangeInflow: number;
  exchangeOutflow: number;
  netFlow: number; // Positive = inflow (bearish), Negative = outflow (bullish)
  burnVolume: number;
  mintVolume: number;
  largeTransactions: number;
  averageTransactionSize: number;
}

export class WhaleTracker extends AgentBase {
  private analysisCache: Map<string, { data: WhaleAnalysis; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute cache
  private currentPrice: number = 0;
  private priceHistory: number[] = [];
  
  // Iceberg Order Detection (Priority 1 Integration)
  private icebergDetector: IcebergOrderDetector;
  private lastIcebergSignal: Map<string, IcebergSignal> = new Map();

  // Phase 93.22 — rate-limit the stale-cache warn to once per 5 min.
  // Forensic audit: Whale Alert rate-limited 134+ consecutive attempts,
  // upstream returned cached data; agent emitted at conf 0.53 as if fresh.
  private lastStaleWarnAt = 0;

  constructor(config?: Partial<AgentConfig>) {
    super({
      name: "WhaleTracker",
      enabled: true,
      updateInterval: 60000, // Update every minute
      timeout: 15000,
      maxRetries: 3,
      ...config,
    });
    
    // Initialize Iceberg Order Detector
    this.icebergDetector = new IcebergOrderDetector({
      minChunkCount: 4,
      sizeTolerancePercent: 0.10,
      priceTolerancePercent: 0.005,
      timeWindowMs: 300000, // 5 minutes
      minConfidence: 0.65,
    });
  }

  protected async initialize(): Promise<void> {
    console.log(`[${this.config.name}] Initializing whale transaction monitoring...`);
  }

  protected async cleanup(): Promise<void> {
    this.analysisCache.clear();
  }

  /**
   * Set current price for dynamic analysis
   */
  public setCurrentPrice(price: number): void {
    this.priceHistory.push(price);
    if (this.priceHistory.length > 20) {
      this.priceHistory.shift();
    }
    this.currentPrice = price;
  }

  protected async analyze(symbol: string, context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();

    try {
      // ========================================
      // ICEBERG ORDER DETECTION (Priority 1)
      // Detect hidden institutional orders before they move the market
      // ========================================
      let icebergSignal: IcebergSignal | null = null;
      let icebergPattern: IcebergPattern | null = null;
      
      if (context?.recentTrades && Array.isArray(context.recentTrades)) {
        // Convert context trades to IcebergOrderDetector format
        const trades: Trade[] = context.recentTrades.map((t: any) => ({
          price: t.price || t.p || 0,
          size: t.size || t.amount || t.qty || t.q || 0,
          side: (t.side || t.type || 'buy').toLowerCase() as 'buy' | 'sell',
          timestamp: t.timestamp || t.time || t.ts || getActiveClock().now(),
        }));
        
        icebergPattern = this.icebergDetector.detectIcebergPattern(symbol, trades);
        
        if (icebergPattern.detected) {
          icebergSignal = this.icebergDetector.generateSignal(symbol, trades);
          if (icebergSignal) {
            this.lastIcebergSignal.set(symbol, icebergSignal);
            console.log(`[${this.config.name}] 🧊 ICEBERG DETECTED: ${symbol} - ${icebergPattern.direction} side, ${icebergPattern.chunkCount} chunks, confidence ${(icebergPattern.confidence * 100).toFixed(1)}%`);
          }
        }
      }
      
      // Use multi-source whale data aggregation for more robust signals
      const aggregatedData = await getAggregatedWhaleData(symbol, {
        orderBookData: context?.orderBookData,
        recentTrades: context?.recentTrades,
        averageTradeSize: context?.averageTradeSize,
        currentPrice: context?.currentPrice || this.currentPrice,
        priceChange24h: context?.priceChange24h,
        volume24h: context?.volume24h,
        high24h: context?.high24h,
        low24h: context?.low24h,
      });

      // Get signal from aggregated data
      let signalResult = getWhaleSignalFromAggregated(aggregatedData);

      // Phase 93.22 — stale-cache demotion. MultiSourceWhaleService does not
      // expose a `cached: boolean` flag, but we can infer staleness from the
      // source set + per-source timestamps. Forensic audit found Whale Alert
      // rate-limited 134+ consecutive times — upstream returned cached data
      // and this agent emitted at conf 0.53 as if fresh, producing a 4.3x
      // bearish skew from one hours-old flow. Two indicators of stale-cache
      // emission:
      //   (a) WhaleAlert is the ONLY real source AND its timestamp is older
      //       than 5 min (the canonical "stale" cutoff for whale flow data).
      //   (b) The only sources are estimates (no WhaleAlert / no real data).
      // In either case, demote confidence to 0.05.
      const nowMs = getActiveClock().now();
      const STALE_MS = 5 * 60 * 1000;
      const whaleAlertSource = aggregatedData.sources.find(s => s.source === "WhaleAlert");
      const realSources = aggregatedData.sources.filter(
        s => s.source !== "PriceBasedEstimate" && s.source !== "OrderBookEstimate" && s.source !== "TradeTapeEstimate"
      );
      const whaleAlertStale =
        whaleAlertSource !== undefined &&
        nowMs - whaleAlertSource.timestamp > STALE_MS;
      const onlyEstimates = realSources.length === 0;
      const whaleAlertOnlyAndStale =
        realSources.length === 1 &&
        realSources[0]?.source === "WhaleAlert" &&
        whaleAlertStale;
      const staleCacheEmission = whaleAlertOnlyAndStale || onlyEstimates;
      if (staleCacheEmission && signalResult.signal !== "neutral") {
        if (nowMs - this.lastStaleWarnAt > 300_000) {
          this.lastStaleWarnAt = nowMs;
          engineLogger.warn('WhaleTracker demoted (stale-cache emission)', {
            agent: this.config.name,
            symbol,
            originalConfidence: signalResult.confidence,
            whaleAlertOnlyAndStale,
            onlyEstimates,
            sourceCount: aggregatedData.sourceCount,
            sources: aggregatedData.sources.map(s => s.source),
          });
        }
        signalResult = {
          ...signalResult,
          confidence: 0.05,
          reasoning: `${signalResult.reasoning} [demoted: stale-cache emission — upstream not fresh]`,
        };
      }

      // ========================================
      // COMBINE ICEBERG SIGNAL WITH WHALE SIGNAL
      // Iceberg detection enhances confidence when aligned
      // ========================================
      let combinedSignal = signalResult.signal;
      let combinedConfidence = signalResult.confidence;
      let combinedReasoning = signalResult.reasoning;
      
      if (icebergSignal && icebergPattern?.detected) {
        const icebergDirection = icebergSignal.direction;
        
        // If iceberg aligns with whale signal, boost confidence
        if (icebergDirection === signalResult.signal) {
          combinedConfidence = Math.min(0.95, combinedConfidence + icebergPattern.confidence * 0.15);
          combinedReasoning = `${combinedReasoning} | ICEBERG CONFIRMED: ${icebergPattern.chunkCount} hidden ${icebergPattern.direction} orders detected (${(icebergPattern.confidence * 100).toFixed(0)}% confidence)`;
        } 
        // If iceberg contradicts whale signal, reduce confidence or flip
        else if (signalResult.signal !== 'neutral') {
          // Iceberg detection is strong evidence - if confidence is high, consider flipping
          if (icebergPattern.confidence > 0.75 && icebergPattern.confidence > signalResult.confidence) {
            combinedSignal = icebergDirection;
            combinedConfidence = icebergPattern.confidence * 0.8; // Slight discount for contradiction
            combinedReasoning = `ICEBERG OVERRIDE: Strong ${icebergPattern.direction} iceberg pattern (${icebergPattern.chunkCount} chunks) contradicts whale flow - institutional activity detected`;
          } else {
            // Reduce confidence due to conflicting signals
            combinedConfidence = Math.max(0.3, combinedConfidence - 0.15);
            combinedReasoning = `${combinedReasoning} | CAUTION: Conflicting iceberg pattern detected (${icebergPattern.direction})`;
          }
        }
        // If whale signal is neutral but iceberg is detected, use iceberg
        else if (signalResult.signal === 'neutral' && icebergPattern.confidence > 0.65) {
          combinedSignal = icebergDirection;
          combinedConfidence = icebergPattern.confidence * 0.7;
          combinedReasoning = `ICEBERG DETECTED: ${icebergPattern.chunkCount} hidden ${icebergPattern.direction} orders averaging ${icebergPattern.averageChunkSize.toFixed(4)} units - institutional accumulation/distribution`;
        }
      }

      // Phase 30: Apply MarketContext regime adjustments
      if (context?.regime) {
        const regime = context.regime as string;
        // Whale activity is MOST important during breakouts and high volatility
        if (regime === 'breakout' && combinedSignal !== 'neutral') {
          combinedConfidence = Math.min(0.95, combinedConfidence * 1.15);
          combinedReasoning += ' [Regime: breakout — whale activity confirms direction]';
        }
        if (regime === 'high_volatility' && combinedSignal !== 'neutral') {
          combinedConfidence = Math.min(0.95, combinedConfidence * 1.10);
          combinedReasoning += ' [Regime: high_volatility — whale moves amplified]';
        }
        // In range-bound: whale activity can signal upcoming breakout
        if (regime === 'range_bound' && combinedSignal !== 'neutral' && combinedConfidence > 0.6) {
          combinedConfidence = Math.min(0.95, combinedConfidence * 1.05);
          combinedReasoning += ' [Regime: range_bound — whale activity may signal breakout]';
        }
      }

      return {
        agentName: this.config.name,
        symbol,
        timestamp: getActiveClock().now(),
        signal: combinedSignal,
        confidence: combinedConfidence,
        strength: aggregatedData.signalStrength,
        reasoning: combinedReasoning,
        evidence: {
          sourceCount: aggregatedData.sourceCount,
          sources: aggregatedData.sources.map(s => s.source),
          aggregatedInflow: `$${(aggregatedData.aggregatedInflow / 1e6).toFixed(2)}M`,
          aggregatedOutflow: `$${(aggregatedData.aggregatedOutflow / 1e6).toFixed(2)}M`,
          netFlow: `$${(aggregatedData.aggregatedNetFlow / 1e6).toFixed(2)}M`,
          largeTransactions: aggregatedData.totalLargeTransactions,
          isMultiSource: aggregatedData.sourceCount > 1,
          // Iceberg detection evidence
          icebergDetected: icebergPattern?.detected || false,
          icebergDirection: icebergPattern?.direction || null,
          icebergConfidence: icebergPattern?.confidence || 0,
          icebergChunks: icebergPattern?.chunkCount || 0,
          icebergEstimatedSize: icebergPattern?.estimatedTotalSize || 0,
        },
        qualityScore: icebergPattern?.detected 
          ? Math.min(0.95, aggregatedData.overallConfidence + 0.1) 
          : aggregatedData.overallConfidence,
        processingTime: getActiveClock().now() - startTime,
        dataFreshness: 0,
        executionScore: icebergPattern?.detected 
          ? Math.min(100, signalResult.executionScore + 10) 
          : signalResult.executionScore,
      };
    } catch (error) {
      console.error(`[${this.config.name}] Multi-source analysis failed:`, error);
      
      // DETERMINISTIC FALLBACK: Use price/volume analysis when all sources fail
      console.warn(`[${this.config.name}] Activating deterministic fallback...`);
      
      const marketData: MarketDataInput = {
        currentPrice: context?.currentPrice || this.currentPrice || 0,
        priceChange24h: context?.priceChange24h || 0,
        volume24h: context?.volume24h || 0,
        high24h: context?.high24h || 0,
        low24h: context?.low24h || 0,
        priceHistory: this.priceHistory,
        volumeHistory: context?.volumeHistory || [],
      };
      
      const fallbackResult = this.generateVolumeFallback(symbol, marketData);
      
      return {
        agentName: this.config.name,
        symbol,
        timestamp: getActiveClock().now(),
        signal: fallbackResult.signal,
        confidence: fallbackResult.confidence,
        strength: fallbackResult.strength,
        reasoning: fallbackResult.reasoning,
        evidence: {
          fallbackReason: "All whale data sources unavailable - using volume-based analysis",
          isDeterministic: true,
          originalError: error instanceof Error ? error.message : "Unknown error",
        },
        qualityScore: 0.5,
        processingTime: getActiveClock().now() - startTime,
        dataFreshness: 0,
        executionScore: 40,
      };
    }
  }

  /**
   * Extract coin symbol from trading pair
   */
  private extractCoinSymbol(symbol: string): string {
    return symbol
      .replace(/USDT$/, "")
      .replace(/USD$/, "")
      .replace(/BTC$/, "")
      .replace(/ETH$/, "")
      .replace(/\//g, "")
      .toLowerCase();
  }

  /**
   * Analyze whale transactions for patterns
   */
  private analyzeTransactions(transactions: WhaleTransaction[], coinSymbol: string): WhaleAnalysis {
    let totalVolume = 0;
    let exchangeInflow = 0;
    let exchangeOutflow = 0;
    let burnVolume = 0;
    let mintVolume = 0;
    let largeTransactions = 0;

    const exchangeKeywords = ["binance", "coinbase", "kraken", "ftx", "huobi", "okex", "bybit", "kucoin", "bitfinex"];

    for (const tx of transactions) {
      const amount = tx.amount_usd;
      totalVolume += amount;

      // Count large transactions (>$5M)
      if (amount > 5000000) {
        largeTransactions++;
      }

      // Analyze transaction type
      if (tx.transaction_type === "burn") {
        burnVolume += amount;
      } else if (tx.transaction_type === "mint") {
        mintVolume += amount;
      } else if (tx.transaction_type === "transfer") {
        // Check if destination is an exchange (selling pressure)
        const toExchange = exchangeKeywords.some(ex => 
          tx.to.owner?.toLowerCase().includes(ex) || 
          tx.to.owner_type?.toLowerCase() === "exchange"
        );
        
        // Check if source is an exchange (accumulation)
        const fromExchange = exchangeKeywords.some(ex => 
          tx.from.owner?.toLowerCase().includes(ex) || 
          tx.from.owner_type?.toLowerCase() === "exchange"
        );

        if (toExchange && !fromExchange) {
          exchangeInflow += amount;
        } else if (fromExchange && !toExchange) {
          exchangeOutflow += amount;
        }
      }
    }

    return {
      totalVolume24h: totalVolume,
      exchangeInflow,
      exchangeOutflow,
      netFlow: exchangeInflow - exchangeOutflow,
      burnVolume,
      mintVolume,
      largeTransactions,
      averageTransactionSize: transactions.length > 0 ? totalVolume / transactions.length : 0,
    };
  }

  /**
   * Generate trading signal from whale analysis
   */
  private generateSignalFromAnalysis(
    symbol: string,
    analysis: WhaleAnalysis,
    startTime: number
  ): AgentSignal {
    let signal: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 0.5;
    let strength = 0.5;
    const reasons: string[] = [];

    // Net flow analysis (most important)
    const flowRatio = analysis.netFlow / (analysis.totalVolume24h || 1);
    
    if (flowRatio > 0.2) {
      // Strong exchange inflow = bearish
      signal = "bearish";
      confidence += 0.2;
      strength += 0.15;
      reasons.push(`Heavy exchange inflows ($${(analysis.exchangeInflow / 1e6).toFixed(1)}M) - selling pressure`);
    } else if (flowRatio < -0.2) {
      // Strong exchange outflow = bullish
      signal = "bullish";
      confidence += 0.2;
      strength += 0.15;
      reasons.push(`Heavy exchange outflows ($${(analysis.exchangeOutflow / 1e6).toFixed(1)}M) - accumulation`);
    } else if (flowRatio > 0.1) {
      signal = "bearish";
      confidence += 0.1;
      strength += 0.08;
      reasons.push(`Moderate exchange inflows - potential selling`);
    } else if (flowRatio < -0.1) {
      signal = "bullish";
      confidence += 0.1;
      strength += 0.08;
      reasons.push(`Moderate exchange outflows - accumulation`);
    }

    // Burn/Mint analysis
    if (analysis.burnVolume > analysis.mintVolume * 2) {
      if (signal !== "bearish") {
        signal = "bullish";
      }
      confidence += 0.08;
      reasons.push(`Significant burn activity ($${(analysis.burnVolume / 1e6).toFixed(1)}M) - supply reduction`);
    } else if (analysis.mintVolume > analysis.burnVolume * 2) {
      if (signal !== "bullish") {
        signal = "bearish";
      }
      confidence += 0.08;
      reasons.push(`Significant mint activity ($${(analysis.mintVolume / 1e6).toFixed(1)}M) - supply increase`);
    }

    // Large transaction activity
    if (analysis.largeTransactions >= 5) {
      confidence += 0.1;
      reasons.push(`${analysis.largeTransactions} large transactions (>$5M) detected - high whale activity`);
    }

    // Volume significance
    if (analysis.totalVolume24h > 100000000) { // >$100M
      confidence += 0.1;
      reasons.push(`High whale volume ($${(analysis.totalVolume24h / 1e9).toFixed(2)}B in 24h)`);
    }

    // Clamp values
    confidence = Math.max(0.1, Math.min(0.9, confidence));
    strength = Math.max(0.1, Math.min(0.9, strength));

    const executionScore = this.calculateExecutionScore(analysis);

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength,
      reasoning: reasons.join(". "),
      evidence: {
        totalVolume24h: `$${(analysis.totalVolume24h / 1e6).toFixed(1)}M`,
        exchangeInflow: `$${(analysis.exchangeInflow / 1e6).toFixed(1)}M`,
        exchangeOutflow: `$${(analysis.exchangeOutflow / 1e6).toFixed(1)}M`,
        netFlow: `$${(analysis.netFlow / 1e6).toFixed(1)}M`,
        burnVolume: `$${(analysis.burnVolume / 1e6).toFixed(1)}M`,
        mintVolume: `$${(analysis.mintVolume / 1e6).toFixed(1)}M`,
        largeTransactions: analysis.largeTransactions,
      },
      qualityScore: this.calculateQualityScore(analysis),
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      executionScore,
    };
  }

  /**
   * Deterministic fallback using volume analysis (Jan 2026 - lowered thresholds)
   */
  private generateVolumeFallback(
    symbol: string,
    data: MarketDataInput
  ): { signal: "bullish" | "bearish" | "neutral"; confidence: number; strength: number; reasoning: string } {
    let signal: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 0.45;
    let strength = 0.45;
    const reasons: string[] = ["[DETERMINISTIC FALLBACK]"];
    let bullishScore = 0;
    let bearishScore = 0;

    // Volume spike detection (proxy for whale activity) - lowered threshold from 2.0 to 1.3
    if (data.volumeHistory && data.volumeHistory.length >= 3) {
      const recentVolume = data.volumeHistory.slice(-2).reduce((a, b) => a + b, 0) / 2;
      const historicalVolume = data.volumeHistory.slice(0, -2).reduce((a, b) => a + b, 0) / Math.max(1, data.volumeHistory.length - 2);
      const volumeRatio = historicalVolume > 0 ? recentVolume / historicalVolume : 1;

      if (volumeRatio > 1.3) {
        // Volume spike with price direction
        if (data.priceChange24h !== undefined && data.priceChange24h > 1) {
          bullishScore += 2;
          confidence += 0.12;
          reasons.push(`Volume spike (${(volumeRatio * 100).toFixed(0)}%) with rising price - whale accumulation`);
        } else if (data.priceChange24h !== undefined && data.priceChange24h < -1) {
          bearishScore += 2;
          confidence += 0.12;
          reasons.push(`Volume spike (${(volumeRatio * 100).toFixed(0)}%) with falling price - whale distribution`);
        }
      } else if (volumeRatio > 1.15) {
        confidence += 0.05;
        reasons.push(`Elevated volume (${(volumeRatio * 100).toFixed(0)}% of average)`);
      }
    }

    // Price momentum - lowered threshold from 3% to 1.5%
    if (data.priceHistory && data.priceHistory.length >= 5) {
      const recentPrices = data.priceHistory.slice(-3);
      const olderPrices = data.priceHistory.slice(-5, -3);
      if (olderPrices.length > 0) {
        const recentAvg = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
        const olderAvg = olderPrices.reduce((a, b) => a + b, 0) / olderPrices.length;
        const momentum = ((recentAvg - olderAvg) / olderAvg) * 100;

        if (momentum > 1.5) {
          bullishScore += 1;
          confidence += 0.08;
          reasons.push(`Positive momentum (+${momentum.toFixed(2)}%) - whale buying pressure`);
        } else if (momentum < -1.5) {
          bearishScore += 1;
          confidence += 0.08;
          reasons.push(`Negative momentum (${momentum.toFixed(2)}%) - whale selling pressure`);
        }
      }
    }

    // 24h price change analysis
    if (data.priceChange24h !== undefined) {
      if (data.priceChange24h > 2) {
        bullishScore += 1;
        reasons.push(`24h gain (+${data.priceChange24h.toFixed(2)}%) suggests accumulation`);
      } else if (data.priceChange24h < -2) {
        bearishScore += 1;
        reasons.push(`24h loss (${data.priceChange24h.toFixed(2)}%) suggests distribution`);
      }
    }

    // Price position in range
    if (data.high24h && data.low24h && data.currentPrice) {
      const range = data.high24h - data.low24h;
      const positionInRange = range > 0 ? (data.currentPrice - data.low24h) / range : 0.5;
      
      if (positionInRange > 0.75) {
        bullishScore += 1;
        reasons.push(`Price near 24h high (${(positionInRange * 100).toFixed(0)}%) - bullish whale activity`);
      } else if (positionInRange < 0.25) {
        bearishScore += 1;
        reasons.push(`Price near 24h low (${(positionInRange * 100).toFixed(0)}%) - bearish whale activity`);
      }
    }

    // Determine signal based on scores
    if (bullishScore > bearishScore && bullishScore >= 1) {
      signal = "bullish";
      strength += (bullishScore - bearishScore) * 0.08;
    } else if (bearishScore > bullishScore && bearishScore >= 1) {
      signal = "bearish";
      strength += (bearishScore - bullishScore) * 0.08;
    }

    confidence = Math.max(0.3, Math.min(0.75, confidence));
    strength = Math.max(0.3, Math.min(0.75, strength));

    return {
      signal,
      confidence,
      strength,
      reasoning: reasons.join(". "),
    };
  }

  /**
   * Calculate quality score based on data completeness
   */
  private calculateQualityScore(analysis: WhaleAnalysis): number {
    let score = 0.5;

    if (analysis.totalVolume24h > 0) score += 0.1;
    if (analysis.largeTransactions > 0) score += 0.1;
    if (analysis.exchangeInflow > 0 || analysis.exchangeOutflow > 0) score += 0.15;
    if (analysis.burnVolume > 0 || analysis.mintVolume > 0) score += 0.1;

    return Math.min(1, score);
  }

  protected async periodicUpdate(): Promise<void> {
    // Periodic background update - pre-fetch whale data for common symbols
    const commonSymbols = ["BTC", "ETH"];
    for (const symbol of commonSymbols) {
      try {
        const whaleData = await fetchWhaleAlerts({
          symbol,
          minValue: 500000,
          startTime: Math.floor((getActiveClock().now() - 24 * 60 * 60 * 1000) / 1000),
          limit: 50,
        });
        if (whaleData.transactions && whaleData.transactions.length > 0) {
          const analysis = this.analyzeTransactions(whaleData.transactions, symbol);
          this.analysisCache.set(symbol, { data: analysis, timestamp: getActiveClock().now() });
        }
      } catch (error) {
        console.error(`[${this.config.name}] Periodic update failed for ${symbol}:`, error);
      }
    }
  }

  /**
   * Calculate execution score for timing quality
   */
  private calculateExecutionScore(analysis: WhaleAnalysis): number {
    let score = 50;

    // Higher score for clear directional flow
    const flowRatio = Math.abs(analysis.netFlow) / (analysis.totalVolume24h || 1);
    score += flowRatio * 30;

    // Higher score for large transactions
    score += Math.min(analysis.largeTransactions * 3, 15);

    return Math.min(100, Math.max(0, score));
  }
  
  // ========================================
  // ICEBERG DETECTION PUBLIC API
  // ========================================
  
  /**
   * Get the last detected iceberg signal for a symbol
   */
  public getLastIcebergSignal(symbol: string): IcebergSignal | null {
    return this.lastIcebergSignal.get(symbol) || null;
  }
  
  /**
   * Get all recent iceberg patterns for a symbol
   */
  public getRecentIcebergPatterns(symbol: string): IcebergPattern[] {
    return this.icebergDetector.getRecentPatterns(symbol);
  }
  
  /**
   * Check if there's an active iceberg pattern for a symbol
   */
  public hasActiveIceberg(symbol: string): boolean {
    const signal = this.lastIcebergSignal.get(symbol);
    if (!signal) return false;
    
    // Consider iceberg active if detected within last 5 minutes
    const ageMs = getActiveClock().now() - signal.timestamp;
    return ageMs < 300000;
  }
  
  /**
   * Get iceberg detection summary for all symbols
   */
  public getIcebergSummary(): { symbol: string; direction: string; confidence: number; age: number }[] {
    const summary: { symbol: string; direction: string; confidence: number; age: number }[] = [];
    
    for (const [symbol, signal] of this.lastIcebergSignal.entries()) {
      summary.push({
        symbol,
        direction: signal.direction,
        confidence: signal.confidence,
        age: getActiveClock().now() - signal.timestamp,
      });
    }
    
    return summary.sort((a, b) => a.age - b.age);
  }
  
  /**
   * Clear iceberg detection cache
   */
  public clearIcebergCache(): void {
    this.lastIcebergSignal.clear();
    this.icebergDetector.clearPatterns();
  }
}

// Export singleton instance for easy access
export const whaleTracker = new WhaleTracker();
