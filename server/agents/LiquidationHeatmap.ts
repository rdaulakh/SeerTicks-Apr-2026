import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';
import { fallbackManager, MarketDataInput } from "./DeterministicFallback";
import { multiExchangeLiquidationService, AggregatedLiquidationData } from "../services/MultiExchangeLiquidationService";
import { engineLogger } from "../utils/logger";

/**
 * LiquidationHeatmap Agent - Phase 2 Implementation
 * 
 * Analyzes potential liquidation levels based on open interest and leverage
 * to identify price magnets and potential cascade liquidation zones.
 * 
 * Features:
 * - Open interest analysis from Binance Futures
 * - Long/Short ratio monitoring
 * - Liquidation level estimation based on common leverage levels
 * - Price magnet detection (high liquidation density zones)
 * - Deterministic fallback when API unavailable
 * 
 * Signal Logic:
 * - High long liquidation cluster above price → Bearish (price magnet)
 * - High short liquidation cluster below price → Bullish (price magnet)
 * - Extreme long/short ratio → Contrarian signal
 * - Rising open interest + price move → Trend confirmation
 */

interface OpenInterestData {
  symbol: string;
  openInterest: number;
  openInterestValue: number; // In USDT
  timestamp: number;
}

interface LongShortRatioData {
  symbol: string;
  longShortRatio: number;
  longAccount: number;
  shortAccount: number;
  timestamp: number;
}

interface LiquidationLevel {
  price: number;
  type: "long" | "short";
  estimatedVolume: number; // Estimated liquidation volume at this level
  leverage: number;
}

interface LiquidationAnalysis {
  currentPrice: number;
  openInterest: number;
  openInterestChange24h: number;
  longShortRatio: number;
  longPercentage: number;
  shortPercentage: number;
  nearestLongLiquidation: LiquidationLevel | null;
  nearestShortLiquidation: LiquidationLevel | null;
  liquidationDensity: "high_longs" | "high_shorts" | "balanced";
  riskLevel: "low" | "medium" | "high" | "extreme";
}

export class LiquidationHeatmap extends AgentBase {
  private analysisCache: Map<string, { data: LiquidationAnalysis; timestamp: number }> = new Map();
  private openInterestHistory: Map<string, number[]> = new Map();
  private readonly CACHE_TTL = 30000; // 30 second cache
  private readonly BINANCE_FUTURES_API = "https://fapi.binance.com";
  private currentPrice: number = 0;
  private priceHistory: number[] = [];

  constructor(config?: Partial<AgentConfig>) {
    super({
      name: "LiquidationHeatmap",
      enabled: true,
      updateInterval: 60000, // Update every minute
      timeout: 15000,
      maxRetries: 3,
      ...config,
    });
  }

  protected async initialize(): Promise<void> {
    engineLogger.info(`[${this.config.name}] Initializing liquidation heatmap analysis...`);
    await this.prefetchData();
  }

  protected async cleanup(): Promise<void> {
    this.analysisCache.clear();
    this.openInterestHistory.clear();
  }

  /**
   * Set current price for dynamic analysis
   */
  public setCurrentPrice(price: number): void {
    this.priceHistory.push(price);
    if (this.priceHistory.length > 50) {
      this.priceHistory.shift();
    }
    this.currentPrice = price;
  }

  protected async analyze(symbol: string, context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();

    // Phase 53.2 — FAST PATH: real-time Binance perp liquidation cascades.
    // The Phase 52 futures WS subscription stashes liquidation events on
    // global.__lastLiquidations. When a meaningful cascade (>$500K notional
    // in the last 60s) hits this symbol's perp, generate a strong directional
    // signal in the cascade direction (LONG-liqs are sell pressure → short
    // continuation; SHORT-liqs are buy pressure → long continuation). This
    // pre-empts the slow REST aggregation by ~5-30s — exactly when the
    // signal matters most.
    const fastPath = this.tryLiquidationCascadeSignal(symbol, startTime);
    if (fastPath) return fastPath;

    try {
      // FIXED: Use multi-exchange service instead of Binance-only
      // This fetches from Bybit, OKX, and Binance in parallel
      const aggregatedData = await multiExchangeLiquidationService.getAggregatedLiquidationData(symbol);
      
      if (aggregatedData && aggregatedData.exchangeCount > 0) {
        return this.generateSignalFromAggregatedData(symbol, aggregatedData, context, startTime);
      }

      // Fallback to legacy Binance-only method if multi-exchange fails
      const futuresSymbol = this.normalizeFuturesSymbol(symbol);
      
      // Check cache first
      const cached = this.analysisCache.get(futuresSymbol);
      if (cached && getActiveClock().now() - cached.timestamp < this.CACHE_TTL) {
        return this.generateSignalFromAnalysis(symbol, cached.data, startTime);
      }

      // Fetch open interest and long/short ratio (legacy Binance-only)
      const [openInterest, longShortRatio, ticker] = await Promise.all([
        this.fetchOpenInterest(futuresSymbol),
        this.fetchLongShortRatio(futuresSymbol),
        this.fetchTicker(futuresSymbol),
      ]);

      if (!openInterest || !ticker) {
        // Use deterministic fallback instead of neutral signal
        const marketData: MarketDataInput = {
          currentPrice: context?.currentPrice || this.currentPrice || 0,
          priceChange24h: context?.priceChange24h || 0,
          volume24h: context?.volume24h || 0,
          high24h: context?.high24h || 0,
          low24h: context?.low24h || 0,
          priceHistory: this.priceHistory,
          volumeHistory: context?.volumeHistory || [],
        };
        
        const fallbackResult = this.generateLiquidationFallback(symbol, marketData);
        
        return {
          agentName: this.config.name,
          symbol,
          timestamp: getActiveClock().now(),
          signal: fallbackResult.signal,
          confidence: fallbackResult.confidence,
          strength: fallbackResult.strength,
          reasoning: fallbackResult.reasoning,
          evidence: {
            fallbackReason: "Binance Futures API unavailable - using volatility-based analysis",
            isDeterministic: true,
          },
          qualityScore: 0.45,
          processingTime: getActiveClock().now() - startTime,
          dataFreshness: 0,
          executionScore: 35,
        };
      }

      // Analyze liquidation levels
      const analysis = this.analyzeLiquidationLevels(
        futuresSymbol,
        openInterest,
        longShortRatio,
        ticker.price
      );
      
      // Cache the analysis
      this.analysisCache.set(futuresSymbol, { data: analysis, timestamp: getActiveClock().now() });

      return this.generateSignalFromAnalysis(symbol, analysis, startTime);
    } catch (error) {
      // DETERMINISTIC FALLBACK: Use price volatility and momentum analysis
      // Note: Silently falling back - Binance API errors are expected in geo-blocked regions
      
      const marketData: MarketDataInput = {
        currentPrice: context?.currentPrice || this.currentPrice || 0,
        priceChange24h: context?.priceChange24h || 0,
        volume24h: context?.volume24h || 0,
        high24h: context?.high24h || 0,
        low24h: context?.low24h || 0,
        priceHistory: this.priceHistory,
        volumeHistory: context?.volumeHistory || [],
      };
      
      const fallbackResult = this.generateLiquidationFallback(symbol, marketData);
      
      return {
        agentName: this.config.name,
        symbol,
        timestamp: getActiveClock().now(),
        signal: fallbackResult.signal,
        confidence: fallbackResult.confidence,
        strength: fallbackResult.strength,
        reasoning: fallbackResult.reasoning,
        evidence: {
          fallbackReason: "Binance Futures API unavailable - using volatility-based analysis",
          isDeterministic: true,
          originalError: error instanceof Error ? error.message : "Unknown error",
        },
        qualityScore: 0.45,
        processingTime: getActiveClock().now() - startTime,
        dataFreshness: 0,
        executionScore: 35,
      };
    }
  }

  protected async periodicUpdate(): Promise<void> {
    await this.prefetchData();
  }

  /**
   * Pre-fetch data for common symbols
   * Note: Silently handles failures - expected when Binance is geo-blocked
   */
  private async prefetchData(): Promise<void> {
    const commonSymbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];
    
    for (const symbol of commonSymbols) {
      try {
        const [openInterest, longShortRatio, ticker] = await Promise.all([
          this.fetchOpenInterest(symbol),
          this.fetchLongShortRatio(symbol),
          this.fetchTicker(symbol),
        ]);

        if (openInterest && ticker) {
          const analysis = this.analyzeLiquidationLevels(
            symbol,
            openInterest,
            longShortRatio,
            ticker.price
          );
          this.analysisCache.set(symbol, { data: analysis, timestamp: getActiveClock().now() });
        }
      } catch (error) {
        // Silently handle errors - expected when Binance is geo-blocked
      }
    }
  }

  /**
   * Normalize symbol for Binance Futures
   */
  private normalizeFuturesSymbol(symbol: string): string {
    return symbol
      .replace(/\//g, "")
      .replace(/-/g, "")
      .toUpperCase();
  }

  /**
   * Phase 53.2 — Real-time liquidation cascade fast-path.
   *
   * Reads from the Phase 52 Binance Futures WS feed (stashed on
   * global.__lastLiquidations). Returns a directional signal only if a
   * meaningful cascade has just hit this symbol; otherwise null and the
   * normal slow-path continues.
   *
   * Direction logic: LONG liquidations are forced sells → bearish for
   * the next 30-90 seconds (continuation). SHORT liquidations are forced
   * buys → bullish. This is well-documented short-horizon momentum.
   * Confidence scales with cascade notional size (bigger = more conviction).
   */
  private tryLiquidationCascadeSignal(symbol: string, startTime: number): AgentSignal | null {
    const liqs = (global as any).__lastLiquidations as Array<{
      symbol: string;
      side: string;       // 'LONG-LIQ' or 'SHORT-LIQ'
      price: number;
      quantity: number;
      notional: number;
      timestamp: number;
    }> | undefined;

    if (!liqs || liqs.length === 0) return null;

    // Match: BTC-USD → BTCUSDT futures symbol
    const futSym = this.normalizeFuturesSymbol(symbol).endsWith('USDT')
      ? this.normalizeFuturesSymbol(symbol)
      : this.normalizeFuturesSymbol(symbol).replace(/USD$/, 'USDT');

    const cutoffMs = getActiveClock().now() - 60_000; // last 60s
    const recent = liqs.filter(l => l.symbol === futSym && l.timestamp >= cutoffMs);
    if (recent.length === 0) return null;

    // Sum cascade direction
    let longLiqNotional = 0;
    let shortLiqNotional = 0;
    for (const l of recent) {
      if (l.side === 'LONG-LIQ') longLiqNotional += l.notional;
      else shortLiqNotional += l.notional;
    }
    const totalNotional = longLiqNotional + shortLiqNotional;

    // Need at least $500K total cascade notional to trigger fast-path
    if (totalNotional < 500_000) return null;

    // Direction: bigger side wins; ratio determines conviction
    const isBearish = longLiqNotional > shortLiqNotional;
    const dominantSide = isBearish ? longLiqNotional : shortLiqNotional;
    const dominanceRatio = dominantSide / totalNotional; // 0.5–1.0

    // Confidence scales with size + dominance.
    // $500K, 50% dominance → 0.55. $5M, 90% dominance → 0.85. Cap at 0.90.
    const sizeFactor = Math.min(totalNotional / 5_000_000, 1); // saturates at $5M
    const confidence = Math.min(0.50 + sizeFactor * 0.30 + (dominanceRatio - 0.5) * 0.30, 0.90);

    const signal = isBearish ? 'bearish' : 'bullish';
    const reasoning = `Liquidation cascade fast-path: $${(totalNotional / 1000).toFixed(0)}K notional in last 60s, ${(dominanceRatio * 100).toFixed(0)}% ${isBearish ? 'long-liqs (sell pressure)' : 'short-liqs (buy pressure)'} on ${futSym} perp → ${signal} continuation`;

    engineLogger.info(`[LiquidationHeatmap] cascade fast-path fired for ${symbol}: ${reasoning}`);

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: dominanceRatio,
      reasoning,
      evidence: {
        cascadeNotionalUSD: totalNotional,
        longLiqNotional,
        shortLiqNotional,
        dominanceRatio,
        eventCount: recent.length,
        futuresSymbol: futSym,
        source: 'binance-perp-forceOrder-ws',
        fastPath: true,
      },
      qualityScore: 0.80, // real-time WS data is high quality
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: getActiveClock().now() - Math.max(...recent.map(l => l.timestamp)), // ms since most recent liq
      executionScore: Math.round(50 + sizeFactor * 40), // bigger cascade = better execution timing
    };
  }

  /**
   * Fetch current ticker price
   */
  private async fetchTicker(symbol: string): Promise<{ price: number } | null> {
    try {
      const response = await fetch(
        `${this.BINANCE_FUTURES_API}/fapi/v1/ticker/price?symbol=${symbol}`
      );

      if (!response.ok) return null;

      const data = await response.json();
      return { price: parseFloat(data.price) };
    } catch (error) {
      return null;
    }
  }

  // Track if we've already logged the Binance geo-block warning
  private static binanceGeoBlockLogged = false;
  
  /**
   * Fetch open interest from Binance Futures
   * Note: Binance Futures API is geo-blocked in many regions.
   * This will silently fall back to deterministic analysis.
   */
  private async fetchOpenInterest(symbol: string): Promise<OpenInterestData | null> {
    try {
      const response = await fetch(
        `${this.BINANCE_FUTURES_API}/fapi/v1/openInterest?symbol=${symbol}`,
        { signal: AbortSignal.timeout(5000) } // 5 second timeout
      );

      if (!response.ok) {
        // Silently handle 400/403/451 (geo-block) errors - expected in many regions
        if ([400, 403, 451].includes(response.status)) {
          if (!LiquidationHeatmap.binanceGeoBlockLogged) {
            engineLogger.warn(`[${this.config.name}] Binance Futures API unavailable (geo-blocked) - using deterministic fallback`);
            LiquidationHeatmap.binanceGeoBlockLogged = true;
          }
          return null;
        }
        return null;
      }

      const data = await response.json();
      
      // Track historical open interest
      const history = this.openInterestHistory.get(symbol) || [];
      history.push(parseFloat(data.openInterest));
      if (history.length > 24) history.shift(); // Keep 24 data points
      this.openInterestHistory.set(symbol, history);

      return {
        symbol: data.symbol,
        openInterest: parseFloat(data.openInterest),
        openInterestValue: 0, // Will be calculated with price
        timestamp: getActiveClock().now(),
      };
    } catch (error) {
      // Silently handle network errors - expected when geo-blocked
      return null;
    }
  }

  /**
   * Fetch long/short ratio from Binance Futures
   * Note: Silently handles geo-block errors
   */
  private async fetchLongShortRatio(symbol: string): Promise<LongShortRatioData | null> {
    try {
      const response = await fetch(
        `${this.BINANCE_FUTURES_API}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`,
        { signal: AbortSignal.timeout(5000) } // 5 second timeout
      );

      if (!response.ok) return null;

      const data = await response.json();
      if (!data || data.length === 0) return null;

      const latest = data[0];
      return {
        symbol,
        longShortRatio: parseFloat(latest.longShortRatio),
        longAccount: parseFloat(latest.longAccount),
        shortAccount: parseFloat(latest.shortAccount),
        timestamp: parseInt(latest.timestamp),
      };
    } catch (error) {
      // Silently handle errors - expected when Binance is geo-blocked
      return null;
    }
  }

  /**
   * Analyze liquidation levels
   */
  private analyzeLiquidationLevels(
    symbol: string,
    openInterest: OpenInterestData,
    longShortRatio: LongShortRatioData | null,
    currentPrice: number
  ): LiquidationAnalysis {
    // Calculate open interest change
    const history = this.openInterestHistory.get(symbol) || [];
    let openInterestChange24h = 0;
    if (history.length >= 2) {
      const oldest = history[0];
      const newest = history[history.length - 1];
      openInterestChange24h = ((newest - oldest) / oldest) * 100;
    }

    // Calculate long/short percentages
    const ratio = longShortRatio?.longShortRatio || 1;
    const longPercentage = (ratio / (1 + ratio)) * 100;
    const shortPercentage = 100 - longPercentage;

    // Estimate liquidation levels based on common leverage
    const leverageLevels = [5, 10, 20, 50, 100];
    const longLiquidations: LiquidationLevel[] = [];
    const shortLiquidations: LiquidationLevel[] = [];

    for (const leverage of leverageLevels) {
      // Long liquidation price (price drops by 1/leverage)
      const longLiqPrice = currentPrice * (1 - 1 / leverage);
      const longVolume = (openInterest.openInterest * longPercentage / 100) / leverageLevels.length;
      longLiquidations.push({
        price: longLiqPrice,
        type: "long",
        estimatedVolume: longVolume,
        leverage,
      });

      // Short liquidation price (price rises by 1/leverage)
      const shortLiqPrice = currentPrice * (1 + 1 / leverage);
      const shortVolume = (openInterest.openInterest * shortPercentage / 100) / leverageLevels.length;
      shortLiquidations.push({
        price: shortLiqPrice,
        type: "short",
        estimatedVolume: shortVolume,
        leverage,
      });
    }

    // Find nearest liquidation levels
    const nearestLongLiquidation = longLiquidations.reduce((nearest, level) => 
      !nearest || level.price > nearest.price ? level : nearest
    , null as LiquidationLevel | null);

    const nearestShortLiquidation = shortLiquidations.reduce((nearest, level) => 
      !nearest || level.price < nearest.price ? level : nearest
    , null as LiquidationLevel | null);

    // Determine liquidation density
    let liquidationDensity: LiquidationAnalysis["liquidationDensity"] = "balanced";
    if (longPercentage > 60) {
      liquidationDensity = "high_longs";
    } else if (shortPercentage > 60) {
      liquidationDensity = "high_shorts";
    }

    // Determine risk level
    let riskLevel: LiquidationAnalysis["riskLevel"] = "low";
    if (ratio > 2 || ratio < 0.5) {
      riskLevel = "extreme";
    } else if (ratio > 1.5 || ratio < 0.67) {
      riskLevel = "high";
    } else if (ratio > 1.2 || ratio < 0.83) {
      riskLevel = "medium";
    }

    return {
      currentPrice,
      openInterest: openInterest.openInterest,
      openInterestChange24h,
      longShortRatio: ratio,
      longPercentage,
      shortPercentage,
      nearestLongLiquidation,
      nearestShortLiquidation,
      liquidationDensity,
      riskLevel,
    };
  }

  /**
   * Generate trading signal from liquidation analysis
   */
  private generateSignalFromAnalysis(
    symbol: string,
    analysis: LiquidationAnalysis,
    startTime: number
  ): AgentSignal {
    let signal: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 0.5;
    let strength = 0.5;
    const reasons: string[] = [];

    // Phase 93 — Trend-aware L/S ratio analysis (was naive contrarian)
    const legacyTrend = this.computeTrendBias(undefined);
    if (analysis.longShortRatio > 2.5) {
      if (legacyTrend !== 'up') {
        signal = "bearish";
        confidence += 0.2;
        strength += 0.15;
        reasons.push(`Extreme long bias (${analysis.longShortRatio.toFixed(2)}:1) + ${legacyTrend} trend - cascade setup`);
      } else {
        reasons.push(`Extreme long bias (${analysis.longShortRatio.toFixed(2)}:1) but uptrend intact - late stage`);
      }
    } else if (analysis.longShortRatio > 2.0) {
      // Phase 94 — raised from 1.7 (retail-noise baseline) to 2.0 (true bias)
      if (legacyTrend === 'up') {
        signal = "bullish";
        confidence += 0.10;
        strength += 0.08;
        reasons.push(`Long bias (${analysis.longShortRatio.toFixed(2)}:1) confirms uptrend`);
      } else if (legacyTrend === 'down') {
        signal = "bearish";
        confidence += 0.12;
        strength += 0.10;
        reasons.push(`Trapped longs (${analysis.longShortRatio.toFixed(2)}:1) in downtrend - bearish continuation`);
      }
    } else if (analysis.longShortRatio < 0.4) {
      if (legacyTrend !== 'down') {
        signal = "bullish";
        confidence += 0.2;
        strength += 0.15;
        reasons.push(`Extreme short bias (${analysis.longShortRatio.toFixed(2)}:1) + ${legacyTrend} trend - squeeze setup`);
      } else {
        reasons.push(`Extreme short bias (${analysis.longShortRatio.toFixed(2)}:1) but downtrend intact - late stage`);
      }
    } else if (analysis.longShortRatio < 0.50) {
      // Phase 94 — lowered from 0.59 (retail-noise mirror) to 0.50 (true bias)
      if (legacyTrend === 'down') {
        signal = "bearish";
        confidence += 0.10;
        strength += 0.08;
        reasons.push(`Short bias (${analysis.longShortRatio.toFixed(2)}:1) confirms downtrend`);
      } else if (legacyTrend === 'up') {
        signal = "bullish";
        confidence += 0.12;
        strength += 0.10;
        reasons.push(`Trapped shorts (${analysis.longShortRatio.toFixed(2)}:1) in uptrend - bullish continuation`);
      }
    }
    // Phase 82.3 — removed "mild bias" branches that fired on |ratio - 1.0| > 0.1.
    // Retail L/S ratio on Binance is structurally >1.0 (long-bias is the norm),
    // so the "mild long bias = bearish" branch fired on every single tick and
    // produced perma-bear 0/103/33 output. Real extremes (>1.5 / <0.67 / etc.)
    // still trigger via the branches above. Ratios in [0.67, 1.5] are now
    // correctly classified neutral — the strong-branch coverage stays intact.

    // Liquidation density analysis
    if (analysis.liquidationDensity === "high_longs") {
      if (signal !== "bullish") {
        signal = "bearish";
      }
      confidence += 0.08;
      reasons.push(`High long liquidation density (${analysis.longPercentage.toFixed(1)}% longs)`);
    } else if (analysis.liquidationDensity === "high_shorts") {
      if (signal !== "bearish") {
        signal = "bullish";
      }
      confidence += 0.08;
      reasons.push(`High short liquidation density (${analysis.shortPercentage.toFixed(1)}% shorts)`);
    }

    // Open interest change analysis
    if (Math.abs(analysis.openInterestChange24h) > 10) {
      confidence += 0.08;
      if (analysis.openInterestChange24h > 0) {
        reasons.push(`Rising open interest (+${analysis.openInterestChange24h.toFixed(1)}%) - new positions entering`);
      } else {
        reasons.push(`Falling open interest (${analysis.openInterestChange24h.toFixed(1)}%) - positions closing`);
      }
    }

    // Risk level adjustment
    if (analysis.riskLevel === "extreme") {
      confidence += 0.1;
      reasons.push("Extreme liquidation risk - high probability of cascade liquidations");
    } else if (analysis.riskLevel === "high") {
      confidence += 0.05;
      reasons.push("High liquidation risk");
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
        openInterest: analysis.openInterest.toFixed(2),
        openInterestChange24h: analysis.openInterestChange24h.toFixed(2) + "%",
        longShortRatio: analysis.longShortRatio.toFixed(2),
        longPercentage: analysis.longPercentage.toFixed(1) + "%",
        shortPercentage: analysis.shortPercentage.toFixed(1) + "%",
        liquidationDensity: analysis.liquidationDensity,
        riskLevel: analysis.riskLevel,
        nearestLongLiq: analysis.nearestLongLiquidation 
          ? `$${analysis.nearestLongLiquidation.price.toFixed(2)} (${analysis.nearestLongLiquidation.leverage}x)`
          : "N/A",
        nearestShortLiq: analysis.nearestShortLiquidation
          ? `$${analysis.nearestShortLiquidation.price.toFixed(2)} (${analysis.nearestShortLiquidation.leverage}x)`
          : "N/A",
      },
      qualityScore: this.calculateQualityScore(analysis),
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      executionScore,
    };
  }

  /**
   * Deterministic fallback using volatility analysis (Jan 2026 - lowered thresholds)
   */
  private generateLiquidationFallback(
    symbol: string,
    data: MarketDataInput
  ): { signal: "bullish" | "bearish" | "neutral"; confidence: number; strength: number; reasoning: string } {
    let signal: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 0.45;
    let strength = 0.45;
    const reasons: string[] = ["[DETERMINISTIC FALLBACK]"];
    let bullishScore = 0;
    let bearishScore = 0;

    // Volatility-based liquidation risk estimation
    if (data.high24h && data.low24h && data.currentPrice) {
      const range = (data.high24h - data.low24h) / data.currentPrice;
      const positionInRange = (data.currentPrice - data.low24h) / (data.high24h - data.low24h);

      // Lowered range threshold from 0.1 to 0.05 (5%)
      if (range > 0.05) {
        // Check position in range with lowered thresholds
        if (positionInRange > 0.7) {
          // Price near high - longs likely overleveraged
          bearishScore += 2;
          confidence += 0.12;
          reasons.push(`Price near 24h high (${(positionInRange * 100).toFixed(0)}% of range) - long liquidation risk`);
        } else if (positionInRange < 0.3) {
          // Price near low - shorts likely overleveraged
          bullishScore += 2;
          confidence += 0.12;
          reasons.push(`Price near 24h low (${(positionInRange * 100).toFixed(0)}% of range) - short liquidation risk`);
        } else if (positionInRange > 0.55) {
          bearishScore += 1;
          reasons.push(`Price in upper half of range (${(positionInRange * 100).toFixed(0)}%)`);
        } else if (positionInRange < 0.45) {
          bullishScore += 1;
          reasons.push(`Price in lower half of range (${(positionInRange * 100).toFixed(0)}%)`);
        }
      }

      // Lowered threshold from 0.15 to 0.08
      if (range > 0.08) {
        confidence += 0.08;
        strength += 0.1;
        reasons.push(`High volatility (${(range * 100).toFixed(1)}% range) - liquidation activity likely`);
      }
    }

    // Price change analysis
    if (data.priceChange24h !== undefined) {
      if (data.priceChange24h > 3) {
        bearishScore += 1;
        reasons.push(`24h gain (+${data.priceChange24h.toFixed(2)}%) - longs may be extended`);
      } else if (data.priceChange24h < -3) {
        bullishScore += 1;
        reasons.push(`24h loss (${data.priceChange24h.toFixed(2)}%) - shorts may be extended`);
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
   * Calculate quality score
   */
  private calculateQualityScore(analysis: LiquidationAnalysis): number {
    let score = 0.55;

    if (analysis.riskLevel === "extreme") score += 0.2;
    else if (analysis.riskLevel === "high") score += 0.15;
    else if (analysis.riskLevel === "medium") score += 0.1;

    if (analysis.liquidationDensity !== "balanced") score += 0.1;
    if (Math.abs(analysis.openInterestChange24h) > 5) score += 0.1;

    return Math.min(1, score);
  }

  /**
   * Phase 93 — Trend bias from local price history.
   * Returns: 'up' | 'down' | 'flat'.
   *
   * Why this exists: prior logic treated long-heavy L/S ratio as unconditional
   * contrarian-bearish ("squeeze coming"). In a strong uptrend, long-heavy is
   * CONFIRMATION (longs are winning), not a contrarian signal. We only fade
   * positioning when the trend has stalled or reversed.
   *
   * Method: fast EMA (5 ticks) vs slow EMA (15 ticks) slope, with a 0.15%
   * deadband to avoid flickering. Falls back to 24h price-change sign if
   * priceHistory is too short.
   */
  private computeTrendBias(context: any): 'up' | 'down' | 'flat' {
    const hist = this.priceHistory;
    const last = hist.length > 0 ? hist[hist.length - 1] : (context?.currentPrice ?? 0);

    if (hist.length >= 15 && last > 0) {
      // Simple EMAs
      const ema = (period: number): number => {
        const k = 2 / (period + 1);
        let v = hist[Math.max(0, hist.length - period * 3)];
        const start = Math.max(0, hist.length - period * 3);
        for (let i = start; i < hist.length; i++) {
          v = hist[i] * k + v * (1 - k);
        }
        return v;
      };
      const fast = ema(5);
      const slow = ema(15);
      const spreadPct = (fast - slow) / slow;
      if (spreadPct > 0.0015) return 'up';
      if (spreadPct < -0.0015) return 'down';
      return 'flat';
    }

    // Fallback: 24h price change sign (>1% threshold to avoid noise)
    const pc = typeof context?.priceChange24h === 'number' ? context.priceChange24h : 0;
    if (pc > 1) return 'up';
    if (pc < -1) return 'down';
    return 'flat';
  }

  /**
   * Generate signal from multi-exchange aggregated liquidation data
   *
   * Phase 93 — TREND-AWARE positioning logic (was naive contrarian).
   *
   * Defect prior to this change:
   *   - Treated avgLongShortRatio > 1.2 ("long_heavy" from MultiExchangeLiquidationService)
   *     as unconditional contrarian-bearish.
   *   - 1.5x bumped to "auto-bearish", 2.0x to "extreme bearish".
   *   - Result: in an uptrend with 1.81x ratio (totally normal for trending markets)
   *     the agent voted 90% bearish — completely wrong (longs were WINNING, not
   *     about to be liquidated). 20% WR, -$13.88 P&L in 60-trade audit.
   *
   * Fix:
   *   1. Compute short-term trend bias (computeTrendBias).
   *   2. Tighten thresholds: positioning is only "extreme" (true cascade risk)
   *      at >2.5x / <0.4x ratio. Below that it's just normal trending bias.
   *   3. In an UPTREND: long-heavy = trend confirmation → bullish (up to a cap).
   *      In a DOWNTREND: short-heavy = trend confirmation → bearish.
   *   4. Contrarian fade ONLY when trend is FLAT (no new highs/lows) AND ratio
   *      is extreme (>2.5x or <0.4x). That's the real squeeze setup.
   */
  private generateSignalFromAggregatedData(
    symbol: string,
    data: AggregatedLiquidationData,
    context: any,
    startTime: number
  ): AgentSignal {
    let signal: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 0.5;
    let strength = 0.5;
    const reasons: string[] = [];
    // Phase 94 — set true when we deliberately want a near-zero confidence
    // signal (e.g. retail-noise deadband). Bypasses exchange-count bonuses,
    // regime multipliers, and the lower clamp.
    let forceNeutralLowConf = false;

    const ratio = data.avgLongShortRatio;
    const trend = this.computeTrendBias(context);

    // Phase 94 thresholds — tightened after May 2026 production audit found
    // STRONG_LONG=1.7 catching the structural 1.7-2.0 retail L/S ratio that
    // hovers as background noise on BTC/ETH/SOL perps. With trend=flat the agent
    // emitted "mild contrarian bearish" at conf 0.64 every tick (722 bearish /
    // 0 bullish in 2h). New thresholds:
    //   - EXTREME_LONG raised effective floor to 2.5 (cascade risk only)
    //   - STRONG_LONG raised 1.7 → 2.0  (true conviction bias, not retail noise)
    //   - EXTREME_SHORT lowered to 0.4
    //   - STRONG_SHORT lowered 0.59 → 0.50
    // And flat-trend deadband [1.5, 2.0] / [0.5, 0.67] now emits low-conf neutral,
    // not a 0.64 contrarian opinion.
    const EXTREME_LONG = 2.5;   // >2.5x = real cluster risk
    const EXTREME_SHORT = 0.4;  // <0.4x = real cluster risk
    const STRONG_LONG = 2.0;    // strong long bias (was 1.7)
    const STRONG_SHORT = 0.50;  // mirror (was 0.59)
    const DEADBAND_LONG_LOW = 1.5;   // 1.5-2.0 = retail-noise zone, neutral when flat
    const DEADBAND_SHORT_HIGH = 0.67; // 0.5-0.67 = retail-noise zone, neutral when flat

    reasons.push(`L/S ratio ${ratio.toFixed(2)}x, ${data.avgLongPercentage.toFixed(1)}% longs, trend=${trend}`);

    // --- Extreme positioning: contrarian fade ONLY if trend has stalled/reversed ---
    if (ratio > EXTREME_LONG) {
      if (trend === 'flat' || trend === 'down') {
        signal = "bearish";
        confidence += 0.20 * data.sentimentStrength;
        strength += 0.15 * data.sentimentStrength;
        reasons.push(`Extreme long bias (${ratio.toFixed(2)}x) + ${trend} trend → contrarian bearish (cascade setup)`);
      } else {
        // Uptrend + extreme longs: late-stage trend, reduce conviction but stay neutral
        confidence -= 0.05;
        reasons.push(`Extreme long bias (${ratio.toFixed(2)}x) but uptrend intact — late-stage, neutral`);
      }
    } else if (ratio < EXTREME_SHORT) {
      if (trend === 'flat' || trend === 'up') {
        signal = "bullish";
        confidence += 0.20 * data.sentimentStrength;
        strength += 0.15 * data.sentimentStrength;
        reasons.push(`Extreme short bias (${ratio.toFixed(2)}x) + ${trend} trend → contrarian bullish (squeeze setup)`);
      } else {
        confidence -= 0.05;
        reasons.push(`Extreme short bias (${ratio.toFixed(2)}x) but downtrend intact — late-stage, neutral`);
      }
    }
    // --- Strong (not extreme) positioning: TREND CONFIRMATION ---
    else if (ratio > STRONG_LONG) {
      if (trend === 'up') {
        signal = "bullish";
        confidence += 0.12;
        strength += 0.10;
        reasons.push(`Long bias (${ratio.toFixed(2)}x) confirms uptrend — longs winning, shorts trapped`);
      } else if (trend === 'down') {
        // Long-heavy positioning in a downtrend = trapped longs, cascade risk
        signal = "bearish";
        confidence += 0.12;
        strength += 0.10;
        reasons.push(`Long bias (${ratio.toFixed(2)}x) against downtrend — trapped longs, bearish continuation`);
      } else {
        // Flat trend + truly strong long bias (>2.0x) — mild contrarian, but
        // softer than before (audit showed this branch fired too often).
        signal = "bearish";
        confidence += 0.04;
        strength += 0.03;
        reasons.push(`Strong long bias (${ratio.toFixed(2)}x) in flat market — mild contrarian bearish`);
      }
    } else if (ratio < STRONG_SHORT) {
      if (trend === 'down') {
        signal = "bearish";
        confidence += 0.12;
        strength += 0.10;
        reasons.push(`Short bias (${ratio.toFixed(2)}x) confirms downtrend — shorts winning, longs capitulating`);
      } else if (trend === 'up') {
        signal = "bullish";
        confidence += 0.12;
        strength += 0.10;
        reasons.push(`Short bias (${ratio.toFixed(2)}x) against uptrend — trapped shorts, bullish continuation`);
      } else {
        signal = "bullish";
        confidence += 0.04;
        strength += 0.03;
        reasons.push(`Strong short bias (${ratio.toFixed(2)}x) in flat market — mild contrarian bullish`);
      }
    }
    // --- Retail-noise deadband (1.5-2.0 longs / 0.5-0.67 shorts) on flat trend:
    //     emit low-conf neutral, NOT a contrarian opinion. This kills the 722
    //     bearish/2h flood seen in May 2026 audit at the structural 1.7-2.0
    //     baseline ratio. When trend is up/down, fall through to balanced branch
    //     so we still get trend-confirmation bias.
    else if (
      (ratio >= DEADBAND_LONG_LOW && ratio <= STRONG_LONG && trend === 'flat') ||
      (ratio >= STRONG_SHORT && ratio <= DEADBAND_SHORT_HIGH && trend === 'flat')
    ) {
      signal = "neutral";
      confidence = 0.02;
      strength = 0.02;
      forceNeutralLowConf = true;
      reasons.push(`L/S ratio ${ratio.toFixed(2)}x is structural retail-noise baseline (flat trend) — neutral, no edge`);
    }
    // --- Mild/balanced positioning: align with trend, no contrarian ---
    else {
      if (trend === 'up') {
        signal = "bullish";
        confidence += 0.04;
        reasons.push(`Balanced positioning + uptrend → mild bullish (no cascade risk)`);
      } else if (trend === 'down') {
        signal = "bearish";
        confidence += 0.04;
        reasons.push(`Balanced positioning + downtrend → mild bearish (no cascade risk)`);
      } else {
        reasons.push(`Balanced positioning + flat trend → neutral`);
      }
    }

    // Phase 94 — skip bonuses/regime/clamp for retail-noise deadband neutral.
    // We want this signal to carry ~0 weight in consensus, not get inflated by
    // multi-exchange confirmation or "high_volatility" regime multiplier.
    if (!forceNeutralLowConf) {
      // Bonus confidence for multiple exchanges agreeing
      if (data.exchangeCount >= 2) {
        confidence += 0.08;
        reasons.push(`Confirmed across ${data.exchangeCount} exchanges`);
      }
      if (data.exchangeCount >= 3) {
        confidence += 0.05;
      }

      // Open interest analysis
      if (data.totalOpenInterestValue > 0) {
        reasons.push(`Total OI: $${(data.totalOpenInterestValue / 1e9).toFixed(2)}B`);
      }

      // Phase 30: Apply MarketContext regime adjustments
      if (context?.regime) {
        const regime = context.regime as string;
        // In high volatility: liquidation data is CRITICAL (cascade risk)
        if (regime === 'high_volatility') {
          confidence = Math.min(0.95, confidence * 1.20);
          reasons.push('[Regime: high_volatility — liquidation cascade risk elevated]');
        }
        // In breakout: extreme positioning confirms breakout direction
        if (regime === 'breakout' && (ratio > 1.5 || ratio < 0.67)) {
          confidence = Math.min(0.95, confidence * 1.10);
          reasons.push('[Regime: breakout — extreme positioning confirms direction]');
        }
        // In range-bound: positioning data less actionable
        if (regime === 'range_bound') {
          confidence *= 0.90;
          reasons.push('[Regime: range_bound — positioning less actionable]');
        }
      }

      // Clamp values
      confidence = Math.max(0.1, Math.min(0.9, confidence));
      strength = Math.max(0.1, Math.min(0.9, strength));
    } else {
      // Open interest still informative for evidence/reasoning, but doesn't
      // change confidence/strength on a deliberate near-zero signal.
      if (data.totalOpenInterestValue > 0) {
        reasons.push(`Total OI: $${(data.totalOpenInterestValue / 1e9).toFixed(2)}B`);
      }
      // Clamp very low — never above 0.05 on a noise-baseline signal.
      confidence = Math.max(0.01, Math.min(0.05, confidence));
      strength = Math.max(0.01, Math.min(0.05, strength));
    }

    // Calculate execution score
    let executionScore = 50;
    if (ratio > 2.0 || ratio < 0.5) executionScore += 25;
    else if (ratio > 1.5 || ratio < 0.67) executionScore += 12;
    executionScore += data.exchangeCount * 5;
    executionScore = Math.min(100, executionScore);

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength,
      reasoning: reasons.join(". "),
      evidence: {
        avgLongShortRatio: data.avgLongShortRatio.toFixed(2),
        avgLongPercentage: data.avgLongPercentage.toFixed(1) + "%",
        avgShortPercentage: data.avgShortPercentage.toFixed(1) + "%",
        totalOpenInterest: data.totalOpenInterest.toFixed(2),
        totalOpenInterestValue: "$" + (data.totalOpenInterestValue / 1e6).toFixed(2) + "M",
        exchangeCount: data.exchangeCount,
        exchanges: data.exchanges.openInterest.map(e => e.exchange).join(", "),
        sentiment: data.sentiment,
        sentimentStrength: data.sentimentStrength.toFixed(2),
        trendBias: trend,  // Phase 93 — trend-aware classification
        multiExchangeEnabled: true,
      },
      qualityScore: 0.65 + (data.exchangeCount * 0.1),
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      executionScore,
    };
  }

  /**
   * Calculate execution score
   */
  private calculateExecutionScore(analysis: LiquidationAnalysis): number {
    let score = 50;

    // Higher score for extreme ratios
    if (analysis.longShortRatio > 2 || analysis.longShortRatio < 0.5) {
      score += 25;
    } else if (analysis.longShortRatio > 1.5 || analysis.longShortRatio < 0.67) {
      score += 15;
    }

    // Higher score for high risk
    if (analysis.riskLevel === "extreme") score += 15;
    else if (analysis.riskLevel === "high") score += 10;

    // Higher score for imbalanced density
    if (analysis.liquidationDensity !== "balanced") score += 10;

    return Math.min(100, Math.max(0, score));
  }
}

// Export singleton instance
export const liquidationHeatmap = new LiquidationHeatmap();
