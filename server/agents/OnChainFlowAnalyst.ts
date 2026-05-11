import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';
import { MarketDataInput } from "./DeterministicFallback";
import { getAggregatedOnChainData, getOnChainSignalFromAggregated } from "../services/MultiSourceOnChainService";
import { getBGeometricsService } from "../services/BGeometricsService";
import { FreeOnChainDataProvider } from "./FreeOnChainDataProvider";

/**
 * OnChainFlowAnalyst Agent - Phase 2 Implementation
 * 
 * Analyzes exchange inflow/outflow patterns to detect accumulation/distribution
 * and potential price movements.
 * 
 * Features:
 * - Exchange inflow/outflow tracking (Glassnode/CryptoQuant style)
 * - Net flow trend analysis
 * - Large deposit/withdrawal detection
 * - Exchange reserve monitoring
 * - Deterministic fallback when API unavailable
 * 
 * Signal Logic:
 * - Large exchange inflows → Bearish (selling pressure incoming)
 * - Large exchange outflows → Bullish (accumulation/hodling)
 * - Rising exchange reserves → Bearish (supply on exchanges)
 * - Falling exchange reserves → Bullish (supply leaving exchanges)
 */

interface ExchangeFlowData {
  symbol: string;
  timestamp: number;
  inflow: number;        // Amount flowing into exchanges (in coins)
  outflow: number;       // Amount flowing out of exchanges (in coins)
  netFlow: number;       // inflow - outflow (positive = bearish)
  inflowUsd: number;     // USD value of inflows
  outflowUsd: number;    // USD value of outflows
  netFlowUsd: number;    // USD value of net flow
  exchangeReserve: number; // Total coins on exchanges
  reserveChange24h: number; // % change in reserves
}

interface FlowAnalysis {
  netFlow: number;
  netFlowUsd: number;
  flowDirection: "inflow" | "outflow" | "balanced";
  flowMagnitude: "extreme" | "large" | "moderate" | "small";
  trend: "accumulation" | "distribution" | "neutral";
  reserveTrend: "rising" | "falling" | "stable";
  exchangeReserve: number;
  reserveChange24h: number;
  largeTransactions: number;
}

export class OnChainFlowAnalyst extends AgentBase {
  private flowCache: Map<string, { data: FlowAnalysis; timestamp: number }> = new Map();
  private historicalFlows: Map<string, number[]> = new Map();
  private readonly CACHE_TTL = 300000; // 5 minute cache
  private currentPrice: number = 0;
  private priceHistory: number[] = [];
  private freeDataProvider: FreeOnChainDataProvider;

  // Thresholds for flow analysis (in USD)
  private readonly EXTREME_FLOW_USD = 100000000;  // $100M
  private readonly LARGE_FLOW_USD = 50000000;     // $50M
  private readonly MODERATE_FLOW_USD = 10000000;  // $10M

  constructor(config?: Partial<AgentConfig>) {
    super({
      name: "OnChainFlowAnalyst",
      enabled: true,
      updateInterval: 300000, // Update every 5 minutes
      timeout: 15000,
      maxRetries: 3,
      ...config,
    });
    this.freeDataProvider = new FreeOnChainDataProvider();
  }

  protected async initialize(): Promise<void> {
    console.log(`[${this.config.name}] Initializing exchange flow monitoring...`);
    await this.prefetchFlowData();
  }

  protected async cleanup(): Promise<void> {
    this.flowCache.clear();
    this.historicalFlows.clear();
  }

  /**
   * Set current price for dynamic analysis
   */
  public setCurrentPrice(price: number): void {
    this.priceHistory.push(price);
    if (this.priceHistory.length > 24) {
      this.priceHistory.shift();
    }
    this.currentPrice = price;
  }

  protected async analyze(symbol: string, context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();

    try {
      // DUAL-SOURCE APPROACH: BGeometrics (institutional on-chain) + MultiSource (exchange flows)
      // BGeometrics provides MVRV, SOPR, NUPL - the real institutional-grade on-chain metrics
      const [bgeometricsSignals, aggregatedData] = await Promise.allSettled([
        this.fetchBGeometricsSignals(),
        getAggregatedOnChainData(symbol, {
          currentPrice: context?.currentPrice || this.currentPrice,
          priceChange24h: context?.priceChange24h,
          volume24h: context?.volume24h,
          volumeChange24h: context?.volumeChange24h,
          high24h: context?.high24h,
          low24h: context?.low24h,
          orderBookData: context?.orderBookData,
        }),
      ]);

      // Extract BGeometrics on-chain signals (MVRV, SOPR, NUPL)
      const bgSignals = bgeometricsSignals.status === 'fulfilled' ? bgeometricsSignals.value : null;
      const flowData = aggregatedData.status === 'fulfilled' ? aggregatedData.value : null;
      const flowSignalResult = flowData ? getOnChainSignalFromAggregated(flowData) : null;

      // Combine signals: BGeometrics (60% weight) + Exchange Flows (40% weight)
      const { signal, confidence, strength, reasoning, evidence } = this.combineOnChainSignals(
        bgSignals,
        flowSignalResult,
        flowData
      );

      // Phase 30: Apply MarketContext regime adjustments
      let adjustedConfidence = confidence;
      let adjustedReasoning = reasoning;
      if (context?.regime) {
        const regime = context.regime as string;
        // On-chain flow is strongest during trend confirmation
        if ((regime === 'trending_up' && signal === 'bullish') || (regime === 'trending_down' && signal === 'bearish')) {
          adjustedConfidence = Math.min(0.95, adjustedConfidence * 1.10);
          adjustedReasoning += ` [Regime: ${regime} — on-chain flow confirms trend]`;
        }
        // In high volatility, on-chain flow data lags
        if (regime === 'high_volatility') {
          adjustedConfidence *= 0.88;
          adjustedReasoning += ' [Regime: high_volatility — on-chain flow lagging]';
        }
      }

      return {
        agentName: this.config.name,
        symbol,
        timestamp: getActiveClock().now(),
        signal,
        confidence: adjustedConfidence,
        strength,
        reasoning: adjustedReasoning,
        evidence,
        qualityScore: bgSignals ? 0.8 : (flowData?.overallConfidence || 0.4),
        processingTime: getActiveClock().now() - startTime,
        dataFreshness: 0,
        executionScore: this.calculateCombinedExecutionScore(bgSignals, flowSignalResult),
      };
    } catch (error) {
      console.error(`[${this.config.name}] Multi-source analysis failed:`, error);
      return this.generateDeterministicFallback(symbol, context, startTime);
    }
  }

  /**
   * Fetch institutional-grade on-chain signals from BGeometrics
   * Returns MVRV, SOPR, NUPL signals - the real on-chain data
   */
  private async fetchBGeometricsSignals(): Promise<{
    mvrv: { value: number; signal: string; strength: number; description: string } | null;
    nupl: { value: number; signal: string; strength: number; description: string } | null;
    sopr: { value: number; signal: string; strength: number; description: string } | null;
    combinedSignal: "bullish" | "bearish" | "neutral";
    combinedConfidence: number;
  }> {
    const bgeometrics = getBGeometricsService();
    const signals = await bgeometrics.getOnChainSignals();

    let bullishCount = 0;
    let bearishCount = 0;
    let totalStrength = 0;
    let mvrv = null;
    let nupl = null;
    let sopr = null;

    for (const sig of signals) {
      if (sig.metric === 'MVRV') mvrv = sig;
      if (sig.metric === 'NUPL') nupl = sig;
      if (sig.metric === 'SOPR') sopr = sig;

      if (sig.signal === 'BULLISH') {
        bullishCount++;
        totalStrength += sig.strength;
      } else if (sig.signal === 'BEARISH') {
        bearishCount++;
        totalStrength += sig.strength;
      }
    }

    const totalSignals = signals.length || 1;
    let combinedSignal: "bullish" | "bearish" | "neutral" = "neutral";
    let combinedConfidence = 0;

    if (bullishCount > bearishCount) {
      combinedSignal = "bullish";
      combinedConfidence = Math.min(0.85, 0.4 + (bullishCount / totalSignals) * 0.3 + (totalStrength / (totalSignals * 100)) * 0.2);
    } else if (bearishCount > bullishCount) {
      combinedSignal = "bearish";
      combinedConfidence = Math.min(0.85, 0.4 + (bearishCount / totalSignals) * 0.3 + (totalStrength / (totalSignals * 100)) * 0.2);
    } else if (bullishCount > 0 && bearishCount > 0) {
      // Mixed signals → reduced confidence
      combinedSignal = "neutral";
      combinedConfidence = 0.3;
    }

    return { mvrv, nupl, sopr, combinedSignal, combinedConfidence };
  }

  /**
   * Combine BGeometrics on-chain signals with exchange flow signals
   * BGeometrics weight: 60% (institutional-grade metrics)
   * Exchange flows weight: 40% (exchange inflow/outflow)
   */
  private combineOnChainSignals(
    bgSignals: Awaited<ReturnType<typeof this.fetchBGeometricsSignals>> | null,
    flowSignalResult: { signal: string; confidence: number; reasoning: string } | null,
    flowData: any | null
  ): {
    signal: "bullish" | "bearish" | "neutral";
    confidence: number;
    strength: number;
    reasoning: string;
    evidence: Record<string, any>;
  } {
    const evidence: Record<string, any> = {};
    const reasoningParts: string[] = [];

    // Score: positive = bullish, negative = bearish
    let combinedScore = 0;
    let totalWeight = 0;

    // BGeometrics signals (60% weight)
    if (bgSignals) {
      const bgWeight = 0.6;
      if (bgSignals.combinedSignal === "bullish") {
        combinedScore += bgSignals.combinedConfidence * bgWeight;
      } else if (bgSignals.combinedSignal === "bearish") {
        combinedScore -= bgSignals.combinedConfidence * bgWeight;
      }
      totalWeight += bgWeight;

      if (bgSignals.mvrv) {
        evidence.mvrv = bgSignals.mvrv.value;
        evidence.mvrvSignal = bgSignals.mvrv.signal;
        reasoningParts.push(`MVRV: ${Number(bgSignals.mvrv.value || 0).toFixed(2)} (${bgSignals.mvrv.description})`);
      }
      if (bgSignals.nupl) {
        evidence.nupl = bgSignals.nupl.value;
        evidence.nuplSignal = bgSignals.nupl.signal;
        reasoningParts.push(`NUPL: ${Number(bgSignals.nupl.value || 0).toFixed(3)} (${bgSignals.nupl.description})`);
      }
      if (bgSignals.sopr) {
        evidence.sopr = bgSignals.sopr.value;
        evidence.soprSignal = bgSignals.sopr.signal;
        reasoningParts.push(`SOPR: ${Number(bgSignals.sopr.value || 0).toFixed(4)} (${bgSignals.sopr.description})`);
      }
      evidence.bgeometricsSignal = bgSignals.combinedSignal;
      evidence.bgeometricsConfidence = bgSignals.combinedConfidence;
    }

    // Exchange flow signals (40% weight)
    if (flowSignalResult && flowData) {
      const flowWeight = 0.4;
      if (flowSignalResult.signal === "bullish") {
        combinedScore += flowSignalResult.confidence * flowWeight;
      } else if (flowSignalResult.signal === "bearish") {
        combinedScore -= flowSignalResult.confidence * flowWeight;
      }
      totalWeight += flowWeight;

      evidence.flowSignal = flowSignalResult.signal;
      evidence.flowConfidence = flowSignalResult.confidence;
      evidence.sourceCount = flowData.sourceCount;
      evidence.netFlow = `$${(flowData.aggregatedNetFlow / 1e6).toFixed(2)}M`;
      evidence.trend = flowData.trend;
      reasoningParts.push(`Exchange flows: ${flowSignalResult.signal} (${flowData.trend})`);
    }

    // Determine final signal
    let signal: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 0;
    const normalizedScore = totalWeight > 0 ? combinedScore / totalWeight : 0;

    if (normalizedScore > 0.15) {
      signal = "bullish";
      confidence = Math.min(0.85, Math.abs(normalizedScore));
    } else if (normalizedScore < -0.15) {
      signal = "bearish";
      confidence = Math.min(0.85, Math.abs(normalizedScore));
    } else {
      confidence = 0.3;
    }

    const strength = Math.min(1.0, Math.abs(normalizedScore) * 1.5);
    const reasoning = reasoningParts.length > 0
      ? reasoningParts.join(". ") + "."
      : "Insufficient on-chain data for analysis.";

    evidence.dataSources = bgSignals ? "BGeometrics + Exchange Flows" : "Exchange Flows only";
    evidence.isMultiSource = !!bgSignals && !!flowData;

    return { signal, confidence, strength, reasoning, evidence };
  }

  /**
   * Calculate combined execution score from both data sources
   */
  private calculateCombinedExecutionScore(
    bgSignals: Awaited<ReturnType<typeof this.fetchBGeometricsSignals>> | null,
    flowSignalResult: { executionScore?: number } | null
  ): number {
    let score = 30; // Base
    if (bgSignals) {
      score += 25; // BGeometrics data available
      if (bgSignals.combinedSignal !== "neutral") score += 15; // Clear signal
    }
    if (flowSignalResult?.executionScore) {
      score += Math.min(30, flowSignalResult.executionScore * 0.3);
    }
    return Math.min(100, score);
  }

  protected async periodicUpdate(): Promise<void> {
    await this.prefetchFlowData();
  }

  /**
   * Pre-fetch flow data for common symbols
   */
  private async prefetchFlowData(): Promise<void> {
    const commonSymbols = ["BTC", "ETH", "SOL", "XRP", "BNB"];
    
    for (const symbol of commonSymbols) {
      try {
        const flowData = await this.fetchExchangeFlowData(symbol);
        if (flowData) {
          const analysis = this.analyzeFlowData(symbol, flowData);
          this.flowCache.set(symbol, { data: analysis, timestamp: getActiveClock().now() });
        }
      } catch (error) {
        console.error(`[${this.config.name}] Prefetch failed for ${symbol}:`, error);
      }
    }
  }

  /**
   * Normalize symbol (remove USDT suffix)
   */
  private normalizeSymbol(symbol: string): string {
    return symbol
      .replace(/USDT$/i, "")
      .replace(/\/USDT$/i, "")
      .replace(/-USDT$/i, "")
      .toUpperCase();
  }

  /**
   * Fetch exchange flow data
   * Uses simulated data based on market conditions since free on-chain APIs are limited
   */
  private async fetchExchangeFlowData(symbol: string): Promise<ExchangeFlowData | null> {
    try {
      // Try to fetch from CryptoQuant-style API (if available)
      // For now, generate realistic simulated data based on market conditions
      const flowData = await this.generateRealisticFlowData(symbol);
      
      // Store historical flows for trend analysis
      const historical = this.historicalFlows.get(symbol) || [];
      historical.push(flowData.netFlow);
      if (historical.length > 24) {
        historical.shift();
      }
      this.historicalFlows.set(symbol, historical);

      return flowData;
    } catch (error) {
      console.error(`[${this.config.name}] Failed to fetch flow data for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Fetch real exchange flow data from free blockchain APIs.
   * Uses mempool.space and blockchain.info via FreeOnChainDataProvider.
   * Previously used Math.random() - now uses actual blockchain data.
   */
  private async generateRealisticFlowData(symbol: string): Promise<ExchangeFlowData> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const price = this.currentPrice || this.getEstimatedPrice(normalizedSymbol);
    const timestamp = getActiveClock().now();

    try {
      // Fetch real exchange flow data from free APIs
      const coinGeckoSymbol = normalizedSymbol === 'BTC' ? 'BTCUSDT' : `${normalizedSymbol}USDT`;
      const flowData = await this.freeDataProvider.getExchangeFlowData(coinGeckoSymbol);

      // Convert USD-denominated flows to coin-denominated
      const inflowCoins = price > 0 ? flowData.inflow / price : 0;
      const outflowCoins = price > 0 ? flowData.outflow / price : 0;
      const netFlowCoins = inflowCoins - outflowCoins;

      // Estimate exchange reserve from known approximate reserves
      const baseReserve = this.getBaseReserve(normalizedSymbol);
      const reserveChange = baseReserve > 0 ? (-netFlowCoins / baseReserve) * 100 : 0;

      return {
        symbol: normalizedSymbol,
        timestamp,
        inflow: inflowCoins,
        outflow: outflowCoins,
        netFlow: netFlowCoins,
        inflowUsd: flowData.inflow,
        outflowUsd: flowData.outflow,
        netFlowUsd: flowData.netFlow,
        exchangeReserve: baseReserve,
        reserveChange24h: reserveChange,
      };
    } catch (error) {
      console.warn(`[${this.config.name}] Free flow data failed for ${symbol}, using price-momentum proxy:`, error);

      // Fallback: use price momentum as proxy (deterministic, no Math.random())
      const priceChange = this.calculatePriceChange();
      const baseFlowMultiplier = this.getBaseFlowMultiplier(normalizedSymbol);

      // Price-momentum based flow estimation (inverse correlation is well-documented)
      // Rising prices correlate with exchange outflows, falling with inflows
      const flowBias = -priceChange * 0.5;
      const baseFlow = 1000 * baseFlowMultiplier;
      const inflow = baseFlow * (1 + flowBias);
      const outflow = baseFlow * (1 - flowBias);
      const netFlow = inflow - outflow;

      const baseReserve = this.getBaseReserve(normalizedSymbol);
      const reserveChange = baseReserve > 0 ? (-netFlow / baseReserve) * 100 : 0;

      return {
        symbol: normalizedSymbol,
        timestamp,
        inflow,
        outflow,
        netFlow,
        inflowUsd: inflow * price,
        outflowUsd: outflow * price,
        netFlowUsd: netFlow * price,
        exchangeReserve: baseReserve,
        reserveChange24h: reserveChange,
      };
    }
  }

  /**
   * Get base flow multiplier by asset
   */
  private getBaseFlowMultiplier(symbol: string): number {
    const multipliers: Record<string, number> = {
      BTC: 100,
      ETH: 1000,
      SOL: 50000,
      XRP: 10000000,
      BNB: 5000,
    };
    return multipliers[symbol] || 10000;
  }

  /**
   * Get estimated price for symbol
   */
  private getEstimatedPrice(symbol: string): number {
    const prices: Record<string, number> = {
      BTC: 95000,
      ETH: 3300,
      SOL: 190,
      XRP: 2.2,
      BNB: 700,
    };
    return prices[symbol] || 100;
  }

  /**
   * Get base exchange reserve by asset
   */
  private getBaseReserve(symbol: string): number {
    const reserves: Record<string, number> = {
      BTC: 2000000,    // ~2M BTC on exchanges
      ETH: 15000000,   // ~15M ETH on exchanges
      SOL: 50000000,   // ~50M SOL on exchanges
      XRP: 5000000000, // ~5B XRP on exchanges
      BNB: 30000000,   // ~30M BNB on exchanges
    };
    return reserves[symbol] || 100000000;
  }

  /**
   * Calculate price change from history
   */
  private calculatePriceChange(): number {
    if (this.priceHistory.length < 2) return 0;
    const current = this.priceHistory[this.priceHistory.length - 1];
    const previous = this.priceHistory[0];
    return (current - previous) / previous;
  }

  /**
   * Analyze flow data
   */
  private analyzeFlowData(symbol: string, data: ExchangeFlowData): FlowAnalysis {
    const netFlowUsd = Math.abs(data.netFlowUsd);
    
    // Determine flow direction
    let flowDirection: FlowAnalysis["flowDirection"] = "balanced";
    if (data.netFlow > 0) {
      flowDirection = "inflow";
    } else if (data.netFlow < 0) {
      flowDirection = "outflow";
    }

    // Determine flow magnitude
    let flowMagnitude: FlowAnalysis["flowMagnitude"] = "small";
    if (netFlowUsd >= this.EXTREME_FLOW_USD) {
      flowMagnitude = "extreme";
    } else if (netFlowUsd >= this.LARGE_FLOW_USD) {
      flowMagnitude = "large";
    } else if (netFlowUsd >= this.MODERATE_FLOW_USD) {
      flowMagnitude = "moderate";
    }

    // Determine trend from historical data
    const historical = this.historicalFlows.get(symbol) || [];
    let trend: FlowAnalysis["trend"] = "neutral";
    if (historical.length >= 6) {
      const recentAvg = historical.slice(-6).reduce((a, b) => a + b, 0) / 6;
      if (recentAvg < -100) {
        trend = "accumulation"; // Consistent outflows
      } else if (recentAvg > 100) {
        trend = "distribution"; // Consistent inflows
      }
    }

    // Determine reserve trend
    let reserveTrend: FlowAnalysis["reserveTrend"] = "stable";
    if (data.reserveChange24h < -1) {
      reserveTrend = "falling";
    } else if (data.reserveChange24h > 1) {
      reserveTrend = "rising";
    }

    // Count large transactions (simplified)
    const largeTransactions = flowMagnitude === "extreme" ? 5 : 
                              flowMagnitude === "large" ? 3 : 
                              flowMagnitude === "moderate" ? 1 : 0;

    return {
      netFlow: data.netFlow,
      netFlowUsd: data.netFlowUsd,
      flowDirection,
      flowMagnitude,
      trend,
      reserveTrend,
      exchangeReserve: data.exchangeReserve,
      reserveChange24h: data.reserveChange24h,
      largeTransactions,
    };
  }

  /**
   * Generate signal from flow analysis
   */
  private generateSignalFromAnalysis(
    symbol: string,
    analysis: FlowAnalysis,
    startTime: number
  ): AgentSignal {
    let signal: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 0.5;
    let strength = 0.5;

    // Flow direction signals
    const flowSignal = this.analyzeFlowDirection(analysis);
    
    // Reserve trend signals
    const reserveSignal = this.analyzeReserveTrend(analysis);
    
    // Trend signals
    const trendSignal = this.analyzeTrend(analysis);

    // Combine signals
    const combinedScore = (flowSignal * 0.4) + (reserveSignal * 0.3) + (trendSignal * 0.3);

    // FIX: Narrowed neutral zone from ±0.2 to ±0.1 so the agent produces
    // directional signals with even moderate flow evidence. Prevents being
    // dropped from consensus for outputting "neutral".
    if (combinedScore > 0.1) {
      signal = "bullish";
      confidence = Math.min(0.5 + Math.abs(combinedScore) * 0.5, 0.9);
      strength = Math.min(Math.abs(combinedScore), 1.0);
    } else if (combinedScore < -0.1) {
      signal = "bearish";
      confidence = Math.min(0.5 + Math.abs(combinedScore) * 0.5, 0.9);
      strength = Math.min(Math.abs(combinedScore), 1.0);
    }

    // Boost confidence for extreme flows
    if (analysis.flowMagnitude === "extreme") {
      confidence = Math.min(confidence + 0.15, 0.95);
    }

    const reasoning = this.buildReasoning(analysis, flowSignal, reserveSignal, trendSignal);
    const executionScore = this.calculateExecutionScore(analysis, signal);

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength,
      executionScore,
      reasoning,
      evidence: {
        netFlow: analysis.netFlow,
        netFlowUsd: analysis.netFlowUsd,
        flowDirection: analysis.flowDirection,
        flowMagnitude: analysis.flowMagnitude,
        trend: analysis.trend,
        reserveTrend: analysis.reserveTrend,
        exchangeReserve: analysis.exchangeReserve,
        reserveChange24h: analysis.reserveChange24h,
        largeTransactions: analysis.largeTransactions,
        flowSignal,
        reserveSignal,
        trendSignal,
      },
      qualityScore: this.calculateQualityScore(analysis),
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 300, // 5 minutes
      recommendation: {
        action: signal === "bullish" ? "buy" : signal === "bearish" ? "sell" : "hold",
        urgency: analysis.flowMagnitude === "extreme" ? "high" : 
                 analysis.flowMagnitude === "large" ? "medium" : "low",
      },
    };
  }

  /**
   * Analyze flow direction for signal
   */
  private analyzeFlowDirection(analysis: FlowAnalysis): number {
    // Outflows are bullish (accumulation), inflows are bearish (distribution)
    if (analysis.flowDirection === "outflow") {
      if (analysis.flowMagnitude === "extreme") return 1.0;
      if (analysis.flowMagnitude === "large") return 0.7;
      if (analysis.flowMagnitude === "moderate") return 0.4;
      return 0.2;
    } else if (analysis.flowDirection === "inflow") {
      if (analysis.flowMagnitude === "extreme") return -1.0;
      if (analysis.flowMagnitude === "large") return -0.7;
      if (analysis.flowMagnitude === "moderate") return -0.4;
      return -0.2;
    }
    return 0;
  }

  /**
   * Analyze reserve trend for signal
   */
  private analyzeReserveTrend(analysis: FlowAnalysis): number {
    // Falling reserves are bullish, rising reserves are bearish
    if (analysis.reserveTrend === "falling") {
      return 0.5 + Math.min(Math.abs(analysis.reserveChange24h) * 0.1, 0.5);
    } else if (analysis.reserveTrend === "rising") {
      return -0.5 - Math.min(Math.abs(analysis.reserveChange24h) * 0.1, 0.5);
    }
    return 0;
  }

  /**
   * Analyze trend for signal
   */
  private analyzeTrend(analysis: FlowAnalysis): number {
    if (analysis.trend === "accumulation") return 0.6;
    if (analysis.trend === "distribution") return -0.6;
    return 0;
  }

  /**
   * Build reasoning string
   */
  private buildReasoning(
    analysis: FlowAnalysis,
    flowSignal: number,
    reserveSignal: number,
    trendSignal: number
  ): string {
    const parts: string[] = [];

    // Flow direction reasoning
    if (analysis.flowDirection === "outflow") {
      parts.push(`${analysis.flowMagnitude} exchange outflows detected ($${this.formatNumber(Math.abs(analysis.netFlowUsd))} net) - accumulation signal`);
    } else if (analysis.flowDirection === "inflow") {
      parts.push(`${analysis.flowMagnitude} exchange inflows detected ($${this.formatNumber(Math.abs(analysis.netFlowUsd))} net) - distribution signal`);
    } else {
      parts.push("Exchange flows balanced");
    }

    // Reserve trend reasoning
    if (analysis.reserveTrend === "falling") {
      parts.push(`Exchange reserves declining (${analysis.reserveChange24h.toFixed(2)}% 24h) - supply leaving exchanges`);
    } else if (analysis.reserveTrend === "rising") {
      parts.push(`Exchange reserves increasing (${analysis.reserveChange24h.toFixed(2)}% 24h) - supply entering exchanges`);
    }

    // Trend reasoning
    if (analysis.trend === "accumulation") {
      parts.push("Consistent accumulation pattern over recent periods");
    } else if (analysis.trend === "distribution") {
      parts.push("Consistent distribution pattern over recent periods");
    }

    // Large transactions
    if (analysis.largeTransactions > 0) {
      parts.push(`${analysis.largeTransactions} large transactions detected`);
    }

    return parts.join(". ") + ".";
  }

  /**
   * Format large numbers
   */
  private formatNumber(num: number): string {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
    if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
    if (num >= 1e3) return (num / 1e3).toFixed(2) + "K";
    return num.toFixed(2);
  }

  /**
   * Calculate execution score
   */
  private calculateExecutionScore(analysis: FlowAnalysis, signal: string): number {
    let score = 50; // Base score

    // Extreme flows boost execution score
    if (analysis.flowMagnitude === "extreme") {
      score += 25;
    } else if (analysis.flowMagnitude === "large") {
      score += 15;
    } else if (analysis.flowMagnitude === "moderate") {
      score += 5;
    }

    // Trend alignment boosts score
    if ((signal === "bullish" && analysis.trend === "accumulation") ||
        (signal === "bearish" && analysis.trend === "distribution")) {
      score += 15;
    }

    // Reserve trend alignment
    if ((signal === "bullish" && analysis.reserveTrend === "falling") ||
        (signal === "bearish" && analysis.reserveTrend === "rising")) {
      score += 10;
    }

    return Math.min(Math.max(score, 0), 100);
  }

  /**
   * Calculate quality score
   */
  private calculateQualityScore(analysis: FlowAnalysis): number {
    let score = 0.5; // Base score

    // More data points increase quality
    const historical = this.historicalFlows.get(analysis.netFlow.toString()) || [];
    if (historical.length >= 12) {
      score += 0.2;
    } else if (historical.length >= 6) {
      score += 0.1;
    }

    // Extreme flows are higher quality signals
    if (analysis.flowMagnitude === "extreme" || analysis.flowMagnitude === "large") {
      score += 0.2;
    }

    // Clear trends are higher quality
    if (analysis.trend !== "neutral") {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Generate deterministic fallback signal
   */
  private generateDeterministicFallback(
    symbol: string,
    context: any,
    startTime: number
  ): AgentSignal {
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

    // Simple deterministic logic based on price momentum
    let signal: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 0.4;
    let strength = 0.3;

    const priceChange = this.calculatePriceChange();
    
    // Inverse correlation: falling prices often precede accumulation
    if (priceChange < -0.03) {
      signal = "bullish"; // Potential accumulation opportunity
      confidence = 0.5;
      strength = Math.min(Math.abs(priceChange) * 5, 0.6);
    } else if (priceChange > 0.05) {
      signal = "bearish"; // Potential distribution
      confidence = 0.5;
      strength = Math.min(Math.abs(priceChange) * 5, 0.6);
    }

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength,
      executionScore: 40,
      reasoning: `Deterministic fallback: Using price momentum analysis. ${priceChange < -0.03 ? "Price decline may indicate accumulation opportunity" : priceChange > 0.05 ? "Price rise may indicate distribution phase" : "No clear flow signal from price action"}`,
      evidence: {
        fallbackReason: "Exchange flow API unavailable - using price momentum analysis",
        isDeterministic: true,
        priceChange,
        priceHistory: this.priceHistory.slice(-5),
      },
      qualityScore: 0.4,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      recommendation: {
        action: signal === "bullish" ? "buy" : signal === "bearish" ? "sell" : "hold",
        urgency: "low",
      },
    };
  }
}


// Export singleton instance
export const onChainFlowAnalyst = new OnChainFlowAnalyst();
