/**
 * Multi-Timeframe Alignment Service
 * 
 * Validates trade entries by checking trend alignment across multiple timeframes.
 * Based on Claude AI recommendations for Week 5-6 Entry System Improvements.
 * 
 * Key Features:
 * - Checks 5m, 15m, 1h, 4h timeframes (skips 1m for noise reduction)
 * - Requires 3 out of 4 timeframes to agree
 * - Higher timeframes get more weight
 * - Uses EMA crossover and price action for trend detection
 */

export interface TimeframeConfig {
  interval: string;
  weight: number;
  required: boolean;
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TrendResult {
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: number; // 0-1
  ema20: number;
  ema50: number;
  pricePosition: 'ABOVE_EMA' | 'BELOW_EMA' | 'AT_EMA';
}

export interface TimeframeScore {
  timeframe: string;
  aligned: boolean;
  confidence: number;
  trend: TrendResult;
}

export interface AlignmentResult {
  isAligned: boolean;
  alignmentScore: number;
  alignedCount: number;
  requiredCount: number;
  timeframeBreakdown: TimeframeScore[];
  reasons: string[];
}

export interface MarketDataService {
  getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
}

export class MultiTimeframeAlignment {
  private config: TimeframeConfig[];
  private marketDataService: MarketDataService | null = null;

  constructor(config?: TimeframeConfig[]) {
    // Default configuration based on Claude AI recommendations
    this.config = config ?? [
      { interval: '5m', weight: 1.0, required: false },
      { interval: '15m', weight: 1.2, required: true },
      { interval: '1h', weight: 1.5, required: true },
      { interval: '4h', weight: 2.0, required: false },
    ];
  }

  /**
   * Set market data service for fetching candles
   */
  setMarketDataService(service: MarketDataService): void {
    this.marketDataService = service;
  }

  /**
   * Check alignment across all configured timeframes
   */
  async checkAlignment(
    symbol: string,
    expectedDirection: 'LONG' | 'SHORT',
    candlesByTimeframe?: Map<string, Candle[]>
  ): Promise<AlignmentResult> {
    const alignmentScores: TimeframeScore[] = [];
    const reasons: string[] = [];

    for (const tf of this.config) {
      let candles: Candle[];

      // Use provided candles or fetch from market data service
      if (candlesByTimeframe?.has(tf.interval)) {
        candles = candlesByTimeframe.get(tf.interval)!;
      } else if (this.marketDataService) {
        try {
          candles = await this.marketDataService.getCandles(symbol, tf.interval, 50);
        } catch (error) {
          reasons.push(`Failed to fetch ${tf.interval} candles: ${error}`);
          alignmentScores.push({
            timeframe: tf.interval,
            aligned: false,
            confidence: 0,
            trend: { direction: 'NEUTRAL', strength: 0, ema20: 0, ema50: 0, pricePosition: 'AT_EMA' },
          });
          continue;
        }
      } else {
        reasons.push(`No candle data available for ${tf.interval}`);
        alignmentScores.push({
          timeframe: tf.interval,
          aligned: false,
          confidence: 0,
          trend: { direction: 'NEUTRAL', strength: 0, ema20: 0, ema50: 0, pricePosition: 'AT_EMA' },
        });
        continue;
      }

      if (candles.length < 50) {
        reasons.push(`Insufficient candles for ${tf.interval}: ${candles.length}/50`);
        alignmentScores.push({
          timeframe: tf.interval,
          aligned: false,
          confidence: 0,
          trend: { direction: 'NEUTRAL', strength: 0, ema20: 0, ema50: 0, pricePosition: 'AT_EMA' },
        });
        continue;
      }

      const trend = this.calculateTrend(candles);
      const aligned =
        (expectedDirection === 'LONG' && trend.direction === 'BULLISH') ||
        (expectedDirection === 'SHORT' && trend.direction === 'BEARISH');

      alignmentScores.push({
        timeframe: tf.interval,
        aligned,
        confidence: trend.strength * tf.weight,
        trend,
      });
    }

    // Count aligned timeframes
    const alignedCount = alignmentScores.filter((a) => a.aligned).length;

    // Check if required timeframes are aligned
    const requiredAligned = this.config
      .filter((tf) => tf.required)
      .every((tf) => alignmentScores.find((a) => a.timeframe === tf.interval)?.aligned);

    // Calculate weighted alignment score
    const weightedAlignment = alignmentScores.reduce((sum, score) => {
      const tfConfig = this.config.find((tf) => tf.interval === score.timeframe);
      const weight = tfConfig?.weight ?? 1.0;
      return sum + (score.aligned ? score.confidence : -score.confidence * 0.5);
    }, 0);

    // Determine if alignment is sufficient (3 out of 4 + required timeframes)
    const isAligned = alignedCount >= 3 && requiredAligned && weightedAlignment > 0;

    if (isAligned) {
      reasons.push(`Timeframes aligned: ${alignedCount}/4 agree on ${expectedDirection}`);
    } else {
      if (alignedCount < 3) {
        reasons.push(`Insufficient timeframe alignment: ${alignedCount}/3 required`);
      }
      if (!requiredAligned) {
        const misalignedRequired = this.config
          .filter((tf) => tf.required)
          .filter((tf) => !alignmentScores.find((a) => a.timeframe === tf.interval)?.aligned)
          .map((tf) => tf.interval);
        reasons.push(`Required timeframes not aligned: ${misalignedRequired.join(', ')}`);
      }
    }

    return {
      isAligned,
      alignmentScore: Math.max(0, weightedAlignment),
      alignedCount,
      requiredCount: 3,
      timeframeBreakdown: alignmentScores,
      reasons,
    };
  }

  /**
   * Calculate trend using EMA crossover and price action
   */
  calculateTrend(candles: Candle[]): TrendResult {
    if (candles.length < 50) {
      return { direction: 'NEUTRAL', strength: 0, ema20: 0, ema50: 0, pricePosition: 'AT_EMA' };
    }

    const closes = candles.map((c) => c.close);
    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const currentPrice = closes[closes.length - 1];

    // Determine EMA trend
    const emaTrend = ema20 > ema50 ? 'BULLISH' : ema20 < ema50 ? 'BEARISH' : 'NEUTRAL';

    // Determine price position relative to EMA
    const priceVsEma = currentPrice > ema20 ? 'BULLISH' : currentPrice < ema20 ? 'BEARISH' : 'NEUTRAL';
    const pricePosition =
      currentPrice > ema20 * 1.001
        ? 'ABOVE_EMA'
        : currentPrice < ema20 * 0.999
        ? 'BELOW_EMA'
        : 'AT_EMA';

    // Calculate strength based on EMA separation
    const emaSeparation = Math.abs(ema20 - ema50) / ema50;
    const strength = Math.min(emaSeparation * 10, 1.0);

    // Direction is confirmed only if EMA trend and price position agree
    const direction = emaTrend === priceVsEma ? emaTrend : 'NEUTRAL';

    return {
      direction,
      strength,
      ema20,
      ema50,
      pricePosition,
    };
  }

  /**
   * Calculate Exponential Moving Average
   */
  private calculateEMA(data: number[], period: number): number {
    if (data.length < period) {
      return data[data.length - 1] || 0;
    }

    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((sum, val) => sum + val, 0) / period;

    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Get configuration
   */
  getConfig(): TimeframeConfig[] {
    return [...this.config];
  }

  /**
   * Update configuration
   */
  updateConfig(config: TimeframeConfig[]): void {
    this.config = config;
  }
}

export default MultiTimeframeAlignment;
