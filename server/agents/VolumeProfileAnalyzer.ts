import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';
import { ExchangeInterface, MarketData } from "../exchanges";
import { getCandleCache } from '../WebSocketCandleCache';
import { engineLogger } from '../utils/logger';

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

interface TrendContext {
  // Phase 93 — trend-awareness for mean-reversion band signals
  // direction: 'up' when last N candles are making higher highs/closes AND VWAP itself is rising;
  // 'down' when symmetric; 'flat' otherwise.
  direction: 'up' | 'down' | 'flat';
  strength: number;          // 0..1 — how confident we are in the trend (slope normalized by stdDev)
  vwapSlopePct: number;      // (vwap_now - vwap_then) / vwap_then over the lookback
  closeSlopePct: number;     // (close_now - close_then) / close_then over the lookback
  higherHighs: number;       // count of strictly-higher highs in lookback
  lowerLows: number;         // count of strictly-lower lows in lookback
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
  currentPrice: number; // Phase 82.3 — last close price; was previously inferred (incorrectly) from VWAP downstream
  trend: TrendContext; // Phase 93 — trend context for context-aware band logic
  nearestHvnDistPct: number; // Phase 93 — % distance to nearest HVN (support/resistance); Infinity if none
  nearestLvnDistPct: number; // Phase 93 — % distance to nearest LVN (breakout zone); Infinity if none
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
    const startTime = getActiveClock().now();

    try {
      // Check cache first
      const cached = this.analysisCache.get(symbol);
      if (cached && getActiveClock().now() - cached.timestamp < this.CACHE_TTL) {
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

      // Phase 94 — STALE CANDLE GUARD.
      // Production audit (May 2026) found this agent emitting bearish at conf 0.38
      // every tick because the latest 1h candle in cache was hours old: VWAP sat at
      // $76,108 while spot was ~$81,500 (6.6% lag), pinning every read at
      // `bandPosition = "extreme_high"` and firing mean-reversion bearish forever.
      // Fix: if the newest candle's close time is older than ~5 minutes, refuse to
      // trade on the stale picture. We can't fix the data source from here, but we
      // can prevent the agent from voting on a broken view of the market.
      const newestCandle = candles[candles.length - 1];
      const candleAgeMs = getActiveClock().now() - newestCandle.timestamp;
      const STALE_CANDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
      if (candleAgeMs > STALE_CANDLE_THRESHOLD_MS) {
        engineLogger.warn(`[${this.config.name}] Stale candle data for ${symbol} — newest candle is ${(candleAgeMs / 1000).toFixed(0)}s old. Emitting low-confidence neutral.`);
        return {
          agentName: this.config.name,
          symbol,
          timestamp: getActiveClock().now(),
          signal: "neutral",
          confidence: 0.05,
          strength: 0.05,
          executionScore: 50,
          reasoning: `Stale candle data — newest 1h candle is ${(candleAgeMs / 60000).toFixed(1)} min old (threshold 5 min). Refusing to vote on stale VWAP/bands.`,
          evidence: {
            staleData: true,
            candleAgeSeconds: Math.round(candleAgeMs / 1000),
            newestCandleTimestamp: newestCandle.timestamp,
          },
          qualityScore: 0,
          processingTime: getActiveClock().now() - startTime,
          dataFreshness: candleAgeMs,
        };
      }

      // Perform volume analysis
      const analysis = this.analyzeVolumeProfile(candles);

      // Cache the analysis
      this.analysisCache.set(symbol, { data: analysis, timestamp: getActiveClock().now() });

      return this.generateSignalFromAnalysis(symbol, analysis, startTime, context);
    } catch (error) {
      console.error(`[${this.config.name}] Analysis failed:`, error);
      return this.createNeutralSignal(symbol, `Volume profile analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  protected async periodicUpdate(): Promise<void> {
    // Clear old cache entries
    const now = getActiveClock().now();
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

    // Phase 93 — compute trend context so band-position logic can be
    // trend-aware (mean-reversion at +2σ is only valid when trend is flat/down).
    const trend = this.computeTrendContext(candles, vwapBands.stdDev);

    // Phase 93 — nearest HVN/LVN proximity in % terms (drives confidence variation)
    const nearestHvnDistPct = this.nearestNodeDistancePct(currentPrice, hvn);
    const nearestLvnDistPct = this.nearestNodeDistancePct(currentPrice, lvn);

    return {
      vwapBands,
      valueArea,
      volumeProfile,
      hvn,
      lvn,
      pricePosition,
      bandPosition,
      volumeDelta,
      currentPrice, // Phase 82.3 — pass through real last-close so downstream uses price, not VWAP
      trend,
      nearestHvnDistPct,
      nearestLvnDistPct,
    };
  }

  /**
   * Phase 93 — compute a lightweight trend context from the recent candles.
   *
   * The previous version of this agent treated +2σ as universally bearish,
   * which is catastrophic in trending markets: it shorted every rally to a new
   * high. The trend context lets `analyzeBandPosition` suppress mean-reversion
   * calls when the underlying trend is clearly going the other way.
   *
   * Trend = 'up' when ALL of:
   *   - VWAP slope over lookback is meaningfully positive (>0.2% per 6 candles)
   *   - Last close is above the close N candles ago by more than 0.3%
   *   - More higher-highs than lower-lows in the lookback window
   * Symmetric for 'down'. Otherwise 'flat'.
   */
  private computeTrendContext(candles: MarketData[], stdDev: number): TrendContext {
    // Use the last 6 candles for trend detection. On 1h candles that's 6 hours
    // — short enough to be responsive, long enough to filter single-candle noise.
    const lookback = Math.min(6, Math.max(3, candles.length - 1));
    if (candles.length < lookback + 1) {
      return {
        direction: 'flat',
        strength: 0,
        vwapSlopePct: 0,
        closeSlopePct: 0,
        higherHighs: 0,
        lowerLows: 0,
      };
    }

    const recent = candles.slice(-lookback - 1);
    const startCandle = recent[0];
    const endCandle = recent[recent.length - 1];

    // Close-to-close slope as a percentage
    const closeSlopePct = startCandle.close > 0
      ? (endCandle.close - startCandle.close) / startCandle.close
      : 0;

    // VWAP slope: simple-VWAP over the older half vs newer half.
    // We don't want to recompute the full volume-weighted VWAP twice; the
    // typical-price * volume mean is a sufficient proxy for slope.
    const halfIdx = Math.floor(recent.length / 2);
    const olderHalf = recent.slice(0, halfIdx);
    const newerHalf = recent.slice(halfIdx);
    const vwapHalf = (slice: MarketData[]): number => {
      let pv = 0;
      let vol = 0;
      for (const c of slice) {
        const tp = (c.high + c.low + c.close) / 3;
        pv += tp * c.volume;
        vol += c.volume;
      }
      return vol > 0 ? pv / vol : 0;
    };
    const vwapOlder = vwapHalf(olderHalf);
    const vwapNewer = vwapHalf(newerHalf);
    const vwapSlopePct = vwapOlder > 0 ? (vwapNewer - vwapOlder) / vwapOlder : 0;

    // Higher-highs / lower-lows count
    let higherHighs = 0;
    let lowerLows = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].high > recent[i - 1].high) higherHighs++;
      if (recent[i].low < recent[i - 1].low) lowerLows++;
    }

    // Strength: blend close-slope normalized by 1σ and structural HH/LL ratio.
    // stdDev is in absolute price units; normalize close move by stdDev/price.
    const normalizedMove = stdDev > 0 && endCandle.close > 0
      ? Math.abs(endCandle.close - startCandle.close) / stdDev
      : 0;
    const structuralRatio = recent.length > 1
      ? Math.abs(higherHighs - lowerLows) / (recent.length - 1)
      : 0;
    const strength = Math.min(1, 0.5 * Math.min(normalizedMove, 1.5) + 0.5 * structuralRatio);

    // Direction decision. Thresholds chosen so that genuine range-bound
    // markets still emit mean-reversion signals (closeSlope < 0.3% over 6h),
    // but a steady uptrend (e.g. 1% / 6h) suppresses the bearish call.
    const VWAP_SLOPE_THRESHOLD = 0.002;   // 0.2%
    const CLOSE_SLOPE_THRESHOLD = 0.003;  // 0.3%

    let direction: TrendContext['direction'] = 'flat';
    if (
      vwapSlopePct > VWAP_SLOPE_THRESHOLD &&
      closeSlopePct > CLOSE_SLOPE_THRESHOLD &&
      higherHighs > lowerLows
    ) {
      direction = 'up';
    } else if (
      vwapSlopePct < -VWAP_SLOPE_THRESHOLD &&
      closeSlopePct < -CLOSE_SLOPE_THRESHOLD &&
      lowerLows > higherHighs
    ) {
      direction = 'down';
    }

    return {
      direction,
      strength,
      vwapSlopePct,
      closeSlopePct,
      higherHighs,
      lowerLows,
    };
  }

  /**
   * Phase 93 — return the smallest % distance from `price` to any node in `nodes`.
   * Returns Infinity if no nodes. Used to scale confidence by HVN/LVN proximity.
   */
  private nearestNodeDistancePct(price: number, nodes: number[]): number {
    if (!nodes.length || price <= 0) return Infinity;
    let best = Infinity;
    for (const n of nodes) {
      const d = Math.abs(price - n) / price;
      if (d < best) best = d;
    }
    return best;
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
    // Phase 82.3 fix — was `analysis.vwapBands.vwap` (compared VWAP to itself
    // in analyzeValueArea, producing perma-bear 0/136/0 because VWAP lags
    // price in uptrends and always sat above VAH). Now uses real last-close.
    const currentPrice = analysis.currentPrice;
    let signal: "bullish" | "bearish" | "neutral" = "neutral";
    // Phase 94.6 — silent-neutral defaults. Forensic audit (Stream C,
    // 2026-05-15) caught this agent emitting `signal='neutral', confidence=0.5`
    // because the `let confidence = 0.5` default was never overwritten on the
    // neutral branch below. With ~22 non-toxic voters in the brain's corpus,
    // a phantom-neutral at conf 0.5 had ~25× the weight it should — diluting
    // every consensus measurement. Default to 0.02 (silent-neutral floor)
    // so a non-directional output contributes ~nothing.
    let confidence = 0.02;
    let strength = 0.02;

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
      confidence = this.computeBandConfidence(analysis, combinedScore, 'bullish');
      strength = Math.min(Math.abs(combinedScore), 1.0);
    } else if (combinedScore < -0.1) {
      signal = "bearish";
      confidence = this.computeBandConfidence(analysis, combinedScore, 'bearish');
      strength = Math.min(Math.abs(combinedScore), 1.0);
    }

    let reasoning = this.buildReasoning(analysis, bandSignal, vaSignal, deltaSignal);
    const executionScore = this.calculateExecutionScore(analysis, signal);

    // Phase 93 — log when the trend-aware override actually changes the call,
    // so we can audit how often the new logic prevents bad mean-reversion shorts.
    if (
      analysis.trend.direction !== 'flat' &&
      (analysis.bandPosition === 'extreme_high' || analysis.bandPosition === 'extreme_low')
    ) {
      engineLogger.debug('VolumeProfileAnalyzer trend-aware band signal', {
        symbol,
        bandPosition: analysis.bandPosition,
        trendDirection: analysis.trend.direction,
        trendStrength: Number(analysis.trend.strength.toFixed(3)),
        vwapSlopePct: Number((analysis.trend.vwapSlopePct * 100).toFixed(3)),
        closeSlopePct: Number((analysis.trend.closeSlopePct * 100).toFixed(3)),
        bandSignal: Number(bandSignal.toFixed(3)),
        finalSignal: signal,
        confidence: Number(confidence.toFixed(3)),
      });
    }

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
      timestamp: getActiveClock().now(),
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
        // Phase 93 — trend context for audit / downstream consumers
        trendDirection: analysis.trend.direction,
        trendStrength: analysis.trend.strength,
        vwapSlopePct: analysis.trend.vwapSlopePct,
        closeSlopePct: analysis.trend.closeSlopePct,
        higherHighs: analysis.trend.higherHighs,
        lowerLows: analysis.trend.lowerLows,
        nearestHvnDistPct: analysis.nearestHvnDistPct === Infinity ? null : analysis.nearestHvnDistPct,
        nearestLvnDistPct: analysis.nearestLvnDistPct === Infinity ? null : analysis.nearestLvnDistPct,
      },
      qualityScore: this.calculateQualityScore(analysis),
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 60, // 1 minute
      recommendation: {
        action: signal === "bullish" ? "buy" : signal === "bearish" ? "sell" : "hold",
        urgency: analysis.bandPosition === "extreme_high" || analysis.bandPosition === "extreme_low" 
          ? "high" : "medium",
      },
    };
  }

  /**
   * Phase 93 — confidence varies with:
   *   (a) how far past the band the price sits (in σ units)
   *   (b) volume-delta agreement with the signal direction
   *   (c) HVN/LVN proximity — close to HVN = strong S/R, close to LVN = breakout zone
   *   (d) trend agreement with the signal direction
   *
   * Previously confidence took only ~3 distinct values across 30 signals;
   * after this change the conviction map is genuinely informative and varies
   * trade-by-trade.
   */
  private computeBandConfidence(
    analysis: VolumeAnalysis,
    combinedScore: number,
    direction: 'bullish' | 'bearish'
  ): number {
    // Base from combined score magnitude — same shape as before but capped lower
    // by default; bonuses below bring it back up when evidence is genuinely strong.
    let conf = 0.45 + Math.min(0.30, Math.abs(combinedScore) * 0.40);

    // (a) Distance past band in σ units. If price is 2.5σ above VWAP, that's
    // more extreme than 2.0σ and deserves slightly more conviction (in either
    // breakout or mean-reversion interpretation).
    const stdDev = analysis.vwapBands.stdDev;
    if (stdDev > 0) {
      const sigmaDist = Math.abs(analysis.currentPrice - analysis.vwapBands.vwap) / stdDev;
      // Bonus saturates around 3σ — beyond that we're in tail territory.
      conf += Math.min(0.08, Math.max(0, (sigmaDist - 1.5) * 0.04));
    }

    // (b) Volume confirmation
    const totalVolume = analysis.valueArea.totalVolume || 1;
    const normalizedDelta = Math.max(-1, Math.min(1, (analysis.volumeDelta / totalVolume) * 10));
    const deltaAligned =
      (direction === 'bullish' && normalizedDelta > 0) ||
      (direction === 'bearish' && normalizedDelta < 0);
    if (deltaAligned) {
      conf += Math.min(0.08, Math.abs(normalizedDelta) * 0.10);
    } else {
      conf -= Math.min(0.06, Math.abs(normalizedDelta) * 0.08);
    }

    // (c) HVN/LVN proximity — bonuses are small (max ±0.05) so structure
    // refines confidence without dominating it.
    if (analysis.nearestHvnDistPct < 0.005) {
      // Within 0.5% of a high-volume node — strong S/R, supports reversal calls
      // (mean-reversion bias at HVN). If our direction is mean-reversion
      // (band-derived bearish at high, bullish at low), HVN proximity boosts.
      const meanRevAligned =
        (direction === 'bearish' &&
          (analysis.bandPosition === 'extreme_high' || analysis.bandPosition === 'high')) ||
        (direction === 'bullish' &&
          (analysis.bandPosition === 'extreme_low' || analysis.bandPosition === 'low'));
      if (meanRevAligned) conf += 0.05;
    }
    if (analysis.nearestLvnDistPct < 0.005) {
      // Within 0.5% of low-volume node — breakout zone. Mean-reversion in a
      // breakout zone is risky; reduce confidence on those calls.
      const meanRevDirected =
        (direction === 'bearish' && analysis.bandPosition === 'extreme_high') ||
        (direction === 'bullish' && analysis.bandPosition === 'extreme_low');
      if (meanRevDirected) conf -= 0.05;
    }

    // (d) Trend agreement. We already filtered most bad mean-reversion calls
    // in analyzeBandPosition, but a residual trend-vs-signal disagreement
    // should still cost conviction.
    if (analysis.trend.direction === 'up' && direction === 'bearish') {
      conf -= 0.06 * analysis.trend.strength;
    } else if (analysis.trend.direction === 'down' && direction === 'bullish') {
      conf -= 0.06 * analysis.trend.strength;
    } else if (analysis.trend.direction === 'up' && direction === 'bullish') {
      conf += 0.04 * analysis.trend.strength;
    } else if (analysis.trend.direction === 'down' && direction === 'bearish') {
      conf += 0.04 * analysis.trend.strength;
    }

    // Clamp to [0.30, 0.90] — the agent should never be more certain than
    // 90% on a single-frame band reading.
    return Math.max(0.30, Math.min(0.90, conf));
  }

  /**
   * Analyze VWAP band position for signal — Phase 93 trend-aware version.
   *
   * The pre-Phase-93 implementation was a pure mean-reversion lookup:
   *   extreme_high → -0.8 (bearish), extreme_low → +0.8 (bullish)
   * That logic shorted every rally to a new high in trending markets and was
   * the single worst-performing agent on the 60-trade attribution audit
   * (19% WR, -$14.51 signed P&L, 100% bearish over a 2h trending-up sample).
   *
   * The fix:
   *   1. At +2σ ("extreme_high"), only emit bearish when trend is FLAT or DOWN.
   *      In a strong uptrend, +2σ is a breakout, not exhaustion — invert to
   *      a small bullish bias (breakout continuation), proportional to trend
   *      strength but capped to avoid overcommitting.
   *   2. Symmetric at -2σ.
   *   3. Volume-delta confirmation: if price is at +2σ AND volume delta is
   *      strongly positive (NET BUYING), suppress the bearish call entirely
   *      — net buying at the top of the band is breakout behaviour.
   *   4. In flat regimes, mean-reversion still fires (preserving the legitimate
   *      range-bound use case).
   */
  private analyzeBandPosition(analysis: VolumeAnalysis): number {
    const trend = analysis.trend;
    const totalVolume = analysis.valueArea.totalVolume || 1;
    // Normalize volumeDelta to [-1, +1] roughly; same scale as analyzeVolumeDelta
    // but kept local so the two helpers don't have to be combined.
    const normalizedDelta = Math.max(
      -1,
      Math.min(1, (analysis.volumeDelta / totalVolume) * 10)
    );
    // "Strongly positive" / "strongly negative" thresholds — picked so that the
    // ~15K positive delta seen in the bug-report sample (totalVolume ~mid-5-figures
    // typical) clears the bar.
    const STRONG_BUY_DELTA = 0.25;
    const STRONG_SELL_DELTA = -0.25;

    // Phase 94 — STRENGTHENED TREND-SUPPRESSION GATE.
    // The strict `trend.direction === 'up'` check (requires VWAP slope AND close
    // slope AND HH>LL simultaneously) was too narrow: in production, sample data
    // with vwapSlopePct +0.0152 and HH=4 vs LL=2 still emitted bearish-at-extreme_high
    // because closeSlope didn't clear the 0.3% threshold, so direction came back
    // as 'flat'. We now use a looser "trending up" / "trending down" check that
    // fires on EITHER strong slope OR clear structural bias — sufficient to
    // suppress mean-reversion bearish even when the strict gate is borderline.
    const VWAP_SLOPE_LOOSE = 0.005; // 0.5% — looser than strict 0.2% direction
    const trendingUp =
      trend.direction === 'up' ||
      trend.vwapSlopePct > VWAP_SLOPE_LOOSE ||
      trend.higherHighs > trend.lowerLows + 1;
    const trendingDown =
      trend.direction === 'down' ||
      trend.vwapSlopePct < -VWAP_SLOPE_LOOSE ||
      trend.lowerLows > trend.higherHighs + 1;

    switch (analysis.bandPosition) {
      case "extreme_high": {
        // Trending up: NEVER emit bearish at +2σ — breakout, not exhaustion.
        if (trendingUp) {
          if (normalizedDelta >= STRONG_BUY_DELTA) {
            // Breakout with volume confirmation — bias bullish, scaled by trend
            // strength. Capped at +0.5 so a single-band reading can't dominate.
            return Math.min(0.5, 0.3 + 0.2 * Math.max(0.3, trend.strength));
          }
          // Trend up without volume confirmation: still go mildly bullish
          // (continuation bias) — emphatically NOT bearish. Audit found the old
          // "return 0" here was upstream-overridden by other components and the
          // signal still emerged bearish. A small positive value protects against that.
          return 0.15;
        }
        // Flat (no trending bias either way): legitimate mean-reversion setup.
        if (normalizedDelta <= STRONG_SELL_DELTA) return -0.8;
        if (normalizedDelta >= STRONG_BUY_DELTA) return -0.3; // buying into the band — weak bear
        return -0.6;
      }
      case "high": {
        // +1σ: weaker signal, same trend filter.
        if (trendingUp) {
          // In an uptrend, +1σ is healthy — don't lean bearish.
          if (normalizedDelta >= STRONG_BUY_DELTA) return 0.25;
          return 0.10;
        }
        if (normalizedDelta <= STRONG_SELL_DELTA) return -0.4;
        return -0.25;
      }
      case "extreme_low": {
        // Trending down: NEVER emit bullish at -2σ — breakdown, not bounce.
        if (trendingDown) {
          if (normalizedDelta <= STRONG_SELL_DELTA) {
            return -Math.min(0.5, 0.3 + 0.2 * Math.max(0.3, trend.strength));
          }
          return -0.15;
        }
        // Flat: legitimate bounce setup.
        if (normalizedDelta >= STRONG_BUY_DELTA) return 0.8;
        if (normalizedDelta <= STRONG_SELL_DELTA) return 0.3; // selling into the band — weak bull
        return 0.6;
      }
      case "low": {
        if (trendingDown) {
          if (normalizedDelta <= STRONG_SELL_DELTA) return -0.25;
          return -0.10;
        }
        if (normalizedDelta >= STRONG_BUY_DELTA) return 0.4;
        return 0.25;
      }
      default:
        return 0;
    }
  }

  /**
   * Analyze value area for signal
   */
  private analyzeValueArea(analysis: VolumeAnalysis): number {
    // Phase 82.3 fix — was comparing VWAP to VAH/VAL (VWAP to itself), which
    // produced perma-bear in uptrends because VWAP cumulatively lags the most-
    // traded zone. Correct logic: compare REAL current price to VAH/VAL.
    const price = analysis.currentPrice;
    const vah = analysis.valueArea.vah;
    const val = analysis.valueArea.val;

    // If price is below VAL, bullish (potential bounce to POC)
    if (price < val) {
      return 0.5;
    }
    // If price is above VAH, bearish (potential pullback to POC)
    if (price > vah) {
      return -0.5;
    }
    // Price within value area — follow volume delta
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

    // Band position — phrasing now depends on trend context so the reasoning
    // string matches the actual signal direction (no more "mean reversion
    // likely" lines on signals that fired bullish-breakout).
    const trendDir = analysis.trend.direction;
    if (analysis.bandPosition === "extreme_high") {
      if (trendDir === 'up') {
        parts.push(
          `Price at +2σ band in UPTREND (VWAP +${(analysis.trend.vwapSlopePct * 100).toFixed(2)}%) — treating as breakout, not exhaustion`
        );
      } else {
        parts.push("Price at +2σ band (overbought, mean reversion likely)");
      }
    } else if (analysis.bandPosition === "extreme_low") {
      if (trendDir === 'down') {
        parts.push(
          `Price at -2σ band in DOWNTREND (VWAP ${(analysis.trend.vwapSlopePct * 100).toFixed(2)}%) — treating as breakdown, not bounce`
        );
      } else {
        parts.push("Price at -2σ band (oversold, bounce likely)");
      }
    } else if (analysis.bandPosition === "high") {
      parts.push(`Price above +1σ band (elevated)${trendDir === 'up' ? ' — uptrend confirmed' : ''}`);
    } else if (analysis.bandPosition === "low") {
      parts.push(`Price below -1σ band (depressed)${trendDir === 'down' ? ' — downtrend confirmed' : ''}`);
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

    // Band position alignment (0-15 points) — Phase 93: only credit the
    // mean-reversion alignment when the trend isn't fighting it. A bearish
    // call at extreme_high in a strong uptrend is the very pattern we just
    // fixed; we don't want to award entry-timing points to that setup.
    const trendDir = analysis.trend.direction;
    if (signal === "bullish" && analysis.bandPosition === "extreme_low" && trendDir !== 'down') {
      score += 15;
    } else if (signal === "bearish" && analysis.bandPosition === "extreme_high" && trendDir !== 'up') {
      score += 15;
    } else if ((signal === "bullish" && analysis.bandPosition === "low" && trendDir !== 'down') ||
               (signal === "bearish" && analysis.bandPosition === "high" && trendDir !== 'up')) {
      score += 10;
    } else if (
      // Breakout alignment — bullish at extreme_high in uptrend, bearish at
      // extreme_low in downtrend — also deserves entry-timing credit.
      (signal === "bullish" && analysis.bandPosition === "extreme_high" && trendDir === 'up') ||
      (signal === "bearish" && analysis.bandPosition === "extreme_low" && trendDir === 'down')
    ) {
      score += 12;
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
