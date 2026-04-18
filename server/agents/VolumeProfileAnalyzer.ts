import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { ExchangeInterface, MarketData } from "../exchanges";
import { getCandleCache } from '../WebSocketCandleCache';

/**
 * VolumeProfileAnalyzer - Phase 2.2 Implementation
 * 
 * Analyzes volume distribution across price levels to identify:
 * - VWAP (Volume Weighted Average Price) and standard deviation bands
 * - POC (Point of Control) - price level with highest volume
 * - Value Area (VA) - price range containing 70% of volume
 * - High Volume Nodes (HVN) - support/resistance from volume
 * - Low Volume Nodes (LVN) - potential breakout zones
 * 
 * Signal Logic:
 * - Price at/near VWAP → Mean reversion opportunity
 * - Price above VWAP + 2σ → Overbought, potential pullback
 * - Price below VWAP - 2σ → Oversold, potential bounce
 * - Price at HVN → Strong support/resistance
 * - Price at LVN → Potential fast move through zone
 */

interface VolumeProfile {
  priceLevel: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number; // buyVolume - sellVolume
}

interface VWAPBands {
  vwap: number;
  upperBand1: number; // +1 standard deviation
  lowerBand1: number; // -1 standard deviation
  upperBand2: number; // +2 standard deviations
  lowerBand2: number; // -2 standard deviations
  upperBand3: number; // +3 standard deviations
  lowerBand3: number; // -3 standard deviations
  stdDev: number;
}

interface ValueArea {
  poc: number;        // Point of Control (highest volume price)
  vah: number;        // Value Area High
  val: number;        // Value Area Low
  valueAreaVolume: number;
  totalVolume: number;
}

interface VolumeAnalysis {
  vwapBands: VWAPBands;
  valueArea: ValueArea;
  volumeProfile: VolumeProfile[];
  hvn: number[];      // High Volume Nodes
  lvn: number[];      // Low Volume Nodes
  pricePosition: "above_vwap" | "below_vwap" | "at_vwap";
  bandPosition: "extreme_high" | "high" | "neutral" | "low" | "extreme_low";
  volumeDelta: number; // Cumulative buy - sell volume
}

export class VolumeProfileAnalyzer extends AgentBase {
  private exchange: ExchangeInterface | null = null;
  private analysisCache: Map<string, { data: VolumeAnalysis; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute cache
  private readonly PROFILE_BINS = 50; // Number of price levels for volume profile

  constructor(config?: Partial<AgentConfig>) {
    super({
      name: "VolumeProfileAnalyzer",
      enabled: true,
      updateInterval: 60000, // Update every minute
      timeout: 15000,
      maxRetries: 3,
      ...config,
    });
  }

  /**
   * Set the exchange adapter for market data
   */
  setExchange(exchange: ExchangeInterface): void {
    this.exchange = exchange;
  }

  protected async initialize(): Promise<void> {
    console.log(`[${this.config.name}] Initializing volume profile analysis...`);
  }

  protected async cleanup(): Promise<void> {
    this.analysisCache.clear();
  }

  protected async analyze(symbol: string, context?: any): Promise<AgentSignal> {
    const startTime = Date.now();

    try {
      // Check cache first
      const cached = this.analysisCache.get(symbol);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return this.generateSignalFromAnalysis(symbol, cached.data, startTime, context);
      }

      // Get candle data from cache or exchange
      const candleCache = getCandleCache();
      let candles = candleCache.getCandles(symbol, '1h', 200);

      if (candles.length < 50) {
        console.warn(`[${this.config.name}] Cache insufficient (${candles.length}/50), trying database fallback...`);
        
        // ONLY use database fallback - NO REST API calls to avoid rate limits
        // WebSocket + TickToCandleAggregator will populate cache over time
        try {
          const { loadCandlesFromDatabase } = await import('../db/candleStorage');
          const dbCandles = await loadCandlesFromDatabase(symbol, '1h', 200);
          if (dbCandles.length >= 50) {
            console.log(`[${this.config.name}] ✅ Loaded ${dbCandles.length} candles from database`);
            candles = dbCandles;
          }
        } catch (dbError) {
          console.warn(`[${this.config.name}] Database fallback failed:`, dbError);
        }
      }

      if (candles.length < 24) {
        return this.createNeutralSignal(symbol, "Insufficient data for volume profile analysis");
      }

      // Perform volume analysis
      const analysis = this.analyzeVolumeProfile(candles);

      // Cache the analysis
      this.analysisCache.set(symbol, { data: analysis, timestamp: Date.now() });

      return this.generateSignalFromAnalysis(symbol, analysis, startTime, context);
    } catch (error) {
      console.error(`[${this.config.name}] Analysis failed:`, error);
      return this.createNeutralSignal(symbol, `Volume profile analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  protected async periodicUpdate(): Promise<void> {
    // Clear old cache entries
    const now = Date.now();
    for (const [key, value] of Array.from(this.analysisCache.entries())) {
      if (now - value.timestamp > this.CACHE_TTL * 2) {
        this.analysisCache.delete(key);
      }
    }
  }

  /**
   * Analyze volume profile from candle data
   */
  private analyzeVolumeProfile(candles: MarketData[]): VolumeAnalysis {
    const currentPrice = candles[candles.length - 1].close;

    // Calculate VWAP with bands
    const vwapBands = this.calculateVWAPBands(candles);

    // Build volume profile
    const volumeProfile = this.buildVolumeProfile(candles);

    // Calculate value area
    const valueArea = this.calculateValueArea(volumeProfile);

    // Find HVN and LVN
    const { hvn, lvn } = this.findVolumeNodes(volumeProfile);

    // Calculate cumulative volume delta
    const volumeDelta = this.calculateVolumeDelta(candles);

    // Determine price position relative to VWAP
    let pricePosition: VolumeAnalysis["pricePosition"] = "at_vwap";
    const vwapDistance = (currentPrice - vwapBands.vwap) / vwapBands.vwap;
    if (vwapDistance > 0.002) {
      pricePosition = "above_vwap";
    } else if (vwapDistance < -0.002) {
      pricePosition = "below_vwap";
    }

    // Determine band position
    let bandPosition: VolumeAnalysis["bandPosition"] = "neutral";
    if (currentPrice >= vwapBands.upperBand2) {
      bandPosition = "extreme_high";
    } else if (currentPrice >= vwapBands.upperBand1) {
      bandPosition = "high";
    } else if (currentPrice <= vwapBands.lowerBand2) {
      bandPosition = "extreme_low";
    } else if (currentPrice <= vwapBands.lowerBand1) {
      bandPosition = "low";
    }

    return {
      vwapBands,
      valueArea,
      volumeProfile,
      hvn,
      lvn,
      pricePosition,
      bandPosition,
      volumeDelta,
    };
  }

  /**
   * Calculate VWAP with standard deviation bands
   */
  private calculateVWAPBands(candles: MarketData[]): VWAPBands {
    // Use last 24 candles for VWAP (24 hours for 1h candles)
    const vwapCandles = candles.slice(-24);

    let cumulativePV = 0;
    let cumulativeVolume = 0;
    const typicalPrices: number[] = [];

    for (const candle of vwapCandles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      typicalPrices.push(typicalPrice);
      cumulativePV += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;
    }

    const vwap = cumulativeVolume > 0 
      ? cumulativePV / cumulativeVolume 
      : typicalPrices.reduce((a, b) => a + b, 0) / typicalPrices.length;

    // Calculate standard deviation of typical prices from VWAP
    let sumSquaredDiff = 0;
    for (let i = 0; i < vwapCandles.length; i++) {
      const typicalPrice = typicalPrices[i];
      const diff = typicalPrice - vwap;
      sumSquaredDiff += diff * diff * vwapCandles[i].volume;
    }

    const variance = cumulativeVolume > 0 ? sumSquaredDiff / cumulativeVolume : 0;
    const stdDev = Math.sqrt(variance);

    return {
      vwap,
      upperBand1: vwap + stdDev,
      lowerBand1: vwap - stdDev,
      upperBand2: vwap + 2 * stdDev,
      lowerBand2: vwap - 2 * stdDev,
      upperBand3: vwap + 3 * stdDev,
      lowerBand3: vwap - 3 * stdDev,
      stdDev,
    };
  }

  /**
   * Build volume profile (volume at each price level)
   */
  private buildVolumeProfile(candles: MarketData[]): VolumeProfile[] {
    // Find price range
    let minPrice = Infinity;
    let maxPrice = -Infinity;

    for (const candle of candles) {
      minPrice = Math.min(minPrice, candle.low);
      maxPrice = Math.max(maxPrice, candle.high);
    }

    const priceRange = maxPrice - minPrice;
    const binSize = priceRange / this.PROFILE_BINS;

    // Initialize bins
    const bins: VolumeProfile[] = [];
    for (let i = 0; i < this.PROFILE_BINS; i++) {
      bins.push({
        priceLevel: minPrice + (i + 0.5) * binSize,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        delta: 0,
      });
    }

    // Distribute volume across bins
    for (const candle of candles) {
      const candleRange = candle.high - candle.low;
      const isBullish = candle.close >= candle.open;

      // Distribute volume proportionally across price levels the candle touched
      for (let i = 0; i < this.PROFILE_BINS; i++) {
        const binLow = minPrice + i * binSize;
        const binHigh = binLow + binSize;

        // Check if candle overlaps with this bin
        if (candle.high >= binLow && candle.low <= binHigh) {
          // Calculate overlap
          const overlapLow = Math.max(candle.low, binLow);
          const overlapHigh = Math.min(candle.high, binHigh);
          const overlapRatio = candleRange > 0 
            ? (overlapHigh - overlapLow) / candleRange 
            : 1 / this.PROFILE_BINS;

          const volumeAtLevel = candle.volume * overlapRatio;
          bins[i].volume += volumeAtLevel;

          // Estimate buy/sell volume based on candle direction
          if (isBullish) {
            bins[i].buyVolume += volumeAtLevel * 0.6;
            bins[i].sellVolume += volumeAtLevel * 0.4;
          } else {
            bins[i].buyVolume += volumeAtLevel * 0.4;
            bins[i].sellVolume += volumeAtLevel * 0.6;
          }
        }
      }
    }

    // Calculate delta for each bin
    for (const bin of bins) {
      bin.delta = bin.buyVolume - bin.sellVolume;
    }

    return bins;
  }

  /**
   * Calculate Value Area (POC, VAH, VAL)
   */
  private calculateValueArea(profile: VolumeProfile[]): ValueArea {
    // Find POC (Point of Control) - highest volume price level
    let pocIndex = 0;
    let maxVolume = 0;
    let totalVolume = 0;

    for (let i = 0; i < profile.length; i++) {
      totalVolume += profile[i].volume;
      if (profile[i].volume > maxVolume) {
        maxVolume = profile[i].volume;
        pocIndex = i;
      }
    }

    const poc = profile[pocIndex].priceLevel;

    // Calculate Value Area (70% of volume)
    const targetVolume = totalVolume * 0.7;
    let valueAreaVolume = profile[pocIndex].volume;
    let upperIndex = pocIndex;
    let lowerIndex = pocIndex;

    // Expand from POC until we capture 70% of volume
    while (valueAreaVolume < targetVolume && (upperIndex < profile.length - 1 || lowerIndex > 0)) {
      const upperVolume = upperIndex < profile.length - 1 ? profile[upperIndex + 1].volume : 0;
      const lowerVolume = lowerIndex > 0 ? profile[lowerIndex - 1].volume : 0;

      if (upperVolume >= lowerVolume && upperIndex < profile.length - 1) {
        upperIndex++;
        valueAreaVolume += profile[upperIndex].volume;
      } else if (lowerIndex > 0) {
        lowerIndex--;
        valueAreaVolume += profile[lowerIndex].volume;
      } else if (upperIndex < profile.length - 1) {
        upperIndex++;
        valueAreaVolume += profile[upperIndex].volume;
      }
    }

    return {
      poc,
      vah: profile[upperIndex].priceLevel,
      val: profile[lowerIndex].priceLevel,
      valueAreaVolume,
      totalVolume,
    };
  }

  /**
   * Find High Volume Nodes (HVN) and Low Volume Nodes (LVN)
   */
  private findVolumeNodes(profile: VolumeProfile[]): { hvn: number[]; lvn: number[] } {
    const hvn: number[] = [];
    const lvn: number[] = [];

    // Calculate average volume
    const avgVolume = profile.reduce((sum, p) => sum + p.volume, 0) / profile.length;

    // Find local maxima (HVN) and minima (LVN)
    for (let i = 1; i < profile.length - 1; i++) {
      const prev = profile[i - 1].volume;
      const curr = profile[i].volume;
      const next = profile[i + 1].volume;

      // HVN: local maximum with volume > 1.5x average
      if (curr > prev && curr > next && curr > avgVolume * 1.5) {
        hvn.push(profile[i].priceLevel);
      }

      // LVN: local minimum with volume < 0.5x average
      if (curr < prev && curr < next && curr < avgVolume * 0.5) {
        lvn.push(profile[i].priceLevel);
      }
    }

    return { hvn, lvn };
  }

  /**
   * Calculate cumulative volume delta
   */
  private calculateVolumeDelta(candles: MarketData[]): number {
    let delta = 0;

    for (const candle of candles) {
      const isBullish = candle.close >= candle.open;
      // Estimate buy/sell volume based on candle direction
      if (isBullish) {
        delta += candle.volume * 0.2; // Net buying
      } else {
        delta -= candle.volume * 0.2; // Net selling
      }
    }

    return delta;
  }

  /**
   * Generate signal from volume analysis
   */
  private generateSignalFromAnalysis(
    symbol: string,
    analysis: VolumeAnalysis,
    startTime: number,
    context?: any
  ): AgentSignal {
    const currentPrice = analysis.vwapBands.vwap; // Approximate
    let signal: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 0.5;
    let strength = 0.5;

    // VWAP band position signals
    const bandSignal = this.analyzeBandPosition(analysis);
    
    // Value area signals
    const vaSignal = this.analyzeValueArea(analysis);
    
    // Volume delta signals
    const deltaSignal = this.analyzeVolumeDelta(analysis);

    // Combine signals
    const combinedScore = (bandSignal * 0.4) + (vaSignal * 0.3) + (deltaSignal * 0.3);

    // FIX: Narrowed neutral zone from ±0.2 to ±0.1 so the agent produces
    // directional signals when there's even moderate evidence (e.g. price at -2σ band).
    // Previously 5 agents outputting "neutral" were dropped entirely from consensus.
    if (combinedScore > 0.1) {
      signal = "bullish";
      confidence = Math.min(0.5 + Math.abs(combinedScore) * 0.5, 0.85);
      strength = Math.min(Math.abs(combinedScore), 1.0);
    } else if (combinedScore < -0.1) {
      signal = "bearish";
      confidence = Math.min(0.5 + Math.abs(combinedScore) * 0.5, 0.85);
      strength = Math.min(Math.abs(combinedScore), 1.0);
    }

    let reasoning = this.buildReasoning(analysis, bandSignal, vaSignal, deltaSignal);
    const executionScore = this.calculateExecutionScore(analysis, signal);

    // Phase 30: Apply MarketContext regime adjustments
    if (context?.regime) {
      const regime = context.regime as string;
      // Volume profile is a mean-reversion tool — strongest in range-bound markets
      if (regime === 'range_bound' || regime === 'mean_reverting') {
        confidence = Math.min(0.95, confidence * 1.12);
        reasoning += ` [Regime: ${regime} — volume profile signal boosted]`;
      }
      // In trending markets, mean-reversion signals are dangerous
      if (regime === 'trending_up' || regime === 'trending_down') {
        confidence *= 0.80;
        reasoning += ` [Regime: ${regime} — mean-reversion dampened in trend]`;
      }
      // In breakout, volume delta becomes more important
      if (regime === 'breakout' && Math.abs(deltaSignal) > 0.3) {
        confidence = Math.min(0.95, confidence * 1.08);
        reasoning += ' [Regime: breakout — volume delta confirms direction]';
      }
    }

    return {
      agentName: this.config.name,
      symbol,
      timestamp: Date.now(),
      signal,
      confidence,
      strength,
      executionScore,
      reasoning,
      evidence: {
        vwap: analysis.vwapBands.vwap,
        stdDev: analysis.vwapBands.stdDev,
        poc: analysis.valueArea.poc,
        vah: analysis.valueArea.vah,
        val: analysis.valueArea.val,
        pricePosition: analysis.pricePosition,
        bandPosition: analysis.bandPosition,
        volumeDelta: analysis.volumeDelta,
        hvnCount: analysis.hvn.length,
        lvnCount: analysis.lvn.length,
        bandSignal,
        vaSignal,
        deltaSignal,
      },
      qualityScore: this.calculateQualityScore(analysis),
      processingTime: Date.now() - startTime,
      dataFreshness: 60, // 1 minute
      recommendation: {
        action: signal === "bullish" ? "buy" : signal === "bearish" ? "sell" : "hold",
        urgency: analysis.bandPosition === "extreme_high" || analysis.bandPosition === "extreme_low" 
          ? "high" : "medium",
      },
    };
  }

  /**
   * Analyze VWAP band position for signal
   */
  private analyzeBandPosition(analysis: VolumeAnalysis): number {
    // Mean reversion logic: extreme positions suggest reversal
    switch (analysis.bandPosition) {
      case "extreme_high":
        return -0.8; // Overbought, bearish
      case "high":
        return -0.4; // Slightly overbought
      case "extreme_low":
        return 0.8; // Oversold, bullish
      case "low":
        return 0.4; // Slightly oversold
      default:
        return 0; // Neutral
    }
  }

  /**
   * Analyze value area for signal
   */
  private analyzeValueArea(analysis: VolumeAnalysis): number {
    // Price relative to POC and value area
    const vwap = analysis.vwapBands.vwap;
    const poc = analysis.valueArea.poc;
    const vah = analysis.valueArea.vah;
    const val = analysis.valueArea.val;

    // If price is below VAL, bullish (potential bounce to POC)
    if (vwap < val) {
      return 0.5;
    }
    // If price is above VAH, bearish (potential pullback to POC)
    if (vwap > vah) {
      return -0.5;
    }
    // Price within value area - follow volume delta
    return 0;
  }

  /**
   * Analyze volume delta for signal
   */
  private analyzeVolumeDelta(analysis: VolumeAnalysis): number {
    // Positive delta = more buying, bullish
    // Negative delta = more selling, bearish
    const normalizedDelta = analysis.volumeDelta / (analysis.valueArea.totalVolume || 1);
    return Math.max(-1, Math.min(1, normalizedDelta * 10));
  }

  /**
   * Build reasoning string
   */
  private buildReasoning(
    analysis: VolumeAnalysis,
    bandSignal: number,
    vaSignal: number,
    deltaSignal: number
  ): string {
    const parts: string[] = [];

    // VWAP position
    parts.push(`VWAP: $${analysis.vwapBands.vwap.toFixed(2)} (±${analysis.vwapBands.stdDev.toFixed(2)} std dev)`);

    // Band position
    if (analysis.bandPosition === "extreme_high") {
      parts.push("Price at +2σ band (overbought, mean reversion likely)");
    } else if (analysis.bandPosition === "extreme_low") {
      parts.push("Price at -2σ band (oversold, bounce likely)");
    } else if (analysis.bandPosition === "high") {
      parts.push("Price above +1σ band (elevated)");
    } else if (analysis.bandPosition === "low") {
      parts.push("Price below -1σ band (depressed)");
    }

    // Value area
    parts.push(`POC: $${analysis.valueArea.poc.toFixed(2)}, VA: $${analysis.valueArea.val.toFixed(2)}-$${analysis.valueArea.vah.toFixed(2)}`);

    // Volume delta
    if (analysis.volumeDelta > 0) {
      parts.push(`Net buying pressure (delta: +${analysis.volumeDelta.toFixed(0)})`);
    } else if (analysis.volumeDelta < 0) {
      parts.push(`Net selling pressure (delta: ${analysis.volumeDelta.toFixed(0)})`);
    }

    // HVN/LVN
    if (analysis.hvn.length > 0) {
      parts.push(`${analysis.hvn.length} high volume nodes (support/resistance)`);
    }
    if (analysis.lvn.length > 0) {
      parts.push(`${analysis.lvn.length} low volume nodes (potential breakout zones)`);
    }

    return parts.join(". ") + ".";
  }

  /**
   * Calculate execution score based on VWAP proximity
   */
  private calculateExecutionScore(analysis: VolumeAnalysis, signal: string): number {
    let score = 50; // Base score

    // VWAP proximity (0-25 points)
    // Better execution when price is near VWAP
    const vwapProximity = Math.abs(analysis.vwapBands.stdDev) > 0 
      ? 1 - Math.min(Math.abs(analysis.bandPosition === "neutral" ? 0 : 1), 1)
      : 0.5;
    score += vwapProximity * 25;

    // Value area position (0-20 points)
    // Better execution within value area
    if (analysis.pricePosition === "at_vwap") {
      score += 20; // At VWAP = optimal institutional entry
    } else {
      score += 10; // Above/below VWAP
    }

    // Band position alignment (0-15 points)
    if ((signal === "bullish" && analysis.bandPosition === "extreme_low") ||
        (signal === "bearish" && analysis.bandPosition === "extreme_high")) {
      score += 15; // Signal aligns with extreme band (high probability)
    } else if ((signal === "bullish" && analysis.bandPosition === "low") ||
               (signal === "bearish" && analysis.bandPosition === "high")) {
      score += 10; // Signal aligns with band direction
    }

    // Volume delta confirmation (0-10 points)
    if ((signal === "bullish" && analysis.volumeDelta > 0) ||
        (signal === "bearish" && analysis.volumeDelta < 0)) {
      score += 10; // Volume delta confirms signal
    }

    return Math.min(Math.max(score, 0), 100);
  }

  /**
   * Calculate quality score
   */
  private calculateQualityScore(analysis: VolumeAnalysis): number {
    let score = 0.5;

    // More volume data = higher quality
    if (analysis.valueArea.totalVolume > 0) {
      score += 0.2;
    }

    // Clear HVN/LVN = higher quality
    if (analysis.hvn.length > 0 || analysis.lvn.length > 0) {
      score += 0.1;
    }

    // Reasonable std dev = higher quality
    if (analysis.vwapBands.stdDev > 0) {
      score += 0.1;
    }

    // Clear band position = higher quality
    if (analysis.bandPosition !== "neutral") {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Get VWAP proximity score for external use (e.g., by TechnicalAnalyst)
   * Returns a score from 0-100 based on how close price is to VWAP
   */
  public getVWAPProximityScore(currentPrice: number, vwap: number, stdDev: number): number {
    if (stdDev === 0) return 50;

    const deviation = Math.abs(currentPrice - vwap) / stdDev;
    
    // Score decreases as price moves away from VWAP
    if (deviation < 0.5) return 100; // Very close to VWAP
    if (deviation < 1.0) return 80;  // Within 1 std dev
    if (deviation < 1.5) return 60;  // Within 1.5 std dev
    if (deviation < 2.0) return 40;  // Within 2 std dev
    return 20; // Beyond 2 std dev
  }
}

// Export singleton instance
export const volumeProfileAnalyzer = new VolumeProfileAnalyzer();
