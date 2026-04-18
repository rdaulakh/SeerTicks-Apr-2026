/**
 * Volume Confirmation Service
 * 
 * Validates trade entries by ensuring sufficient volume participation.
 * Based on Claude AI recommendations for Week 5-6 Entry System Improvements.
 * 
 * Key Features:
 * - Requires 1.5x average volume (dynamic based on volatility)
 * - 20-period lookback for average calculation
 * - Calculates volume percentile ranking
 * - Adjusts threshold based on market volatility
 */

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface VolumeValidation {
  isValid: boolean;
  currentVolume: number;
  averageVolume: number;
  requiredVolume: number;
  volumeRatio: number;
  percentileRank: number;
  volatility: number;
  dynamicMultiplier: number;
  reason: string;
}

export interface VolumeConfirmationConfig {
  baseMultiplier: number; // Base volume multiplier (default: 1.5)
  lookbackPeriods: number; // Periods for average calculation (default: 20)
  highVolatilityThreshold: number; // Volatility threshold for dynamic adjustment (default: 0.02)
  lowVolatilityMultiplier: number; // Multiplier in low volatility (default: 1.5)
  highVolatilityMultiplier: number; // Multiplier in high volatility (default: 1.3)
}

export interface MarketDataService {
  getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
}

export class VolumeConfirmation {
  private config: VolumeConfirmationConfig;
  private marketDataService: MarketDataService | null = null;

  constructor(config?: Partial<VolumeConfirmationConfig>) {
    this.config = {
      baseMultiplier: config?.baseMultiplier ?? 1.5,
      lookbackPeriods: config?.lookbackPeriods ?? 20,
      highVolatilityThreshold: config?.highVolatilityThreshold ?? 0.02,
      lowVolatilityMultiplier: config?.lowVolatilityMultiplier ?? 1.5,
      highVolatilityMultiplier: config?.highVolatilityMultiplier ?? 1.3,
    };
  }

  /**
   * Set market data service for fetching candles
   */
  setMarketDataService(service: MarketDataService): void {
    this.marketDataService = service;
  }

  /**
   * Validate volume for entry
   */
  async validateVolume(
    symbol: string,
    timeframe: string = '5m',
    candles?: Candle[]
  ): Promise<VolumeValidation> {
    let candleData: Candle[];

    // Use provided candles or fetch from market data service
    if (candles && candles.length >= this.config.lookbackPeriods + 1) {
      candleData = candles;
    } else if (this.marketDataService) {
      try {
        candleData = await this.marketDataService.getCandles(
          symbol,
          timeframe,
          this.config.lookbackPeriods + 1
        );
      } catch (error) {
        return {
          isValid: false,
          currentVolume: 0,
          averageVolume: 0,
          requiredVolume: 0,
          volumeRatio: 0,
          percentileRank: 0,
          volatility: 0,
          dynamicMultiplier: this.config.baseMultiplier,
          reason: `Failed to fetch candles: ${error}`,
        };
      }
    } else {
      return {
        isValid: false,
        currentVolume: 0,
        averageVolume: 0,
        requiredVolume: 0,
        volumeRatio: 0,
        percentileRank: 0,
        volatility: 0,
        dynamicMultiplier: this.config.baseMultiplier,
        reason: 'No candle data available',
      };
    }

    if (candleData.length < this.config.lookbackPeriods + 1) {
      return {
        isValid: false,
        currentVolume: 0,
        averageVolume: 0,
        requiredVolume: 0,
        volumeRatio: 0,
        percentileRank: 0,
        volatility: 0,
        dynamicMultiplier: this.config.baseMultiplier,
        reason: `Insufficient data: ${candleData.length}/${this.config.lookbackPeriods + 1} candles`,
      };
    }

    const currentCandle = candleData[candleData.length - 1];
    const historicalCandles = candleData.slice(0, -1);

    // Calculate average volume
    const avgVolume =
      historicalCandles.reduce((sum, c) => sum + c.volume, 0) / historicalCandles.length;

    // Calculate volume percentile
    const sortedVolumes = historicalCandles.map((c) => c.volume).sort((a, b) => a - b);
    const percentileRank = this.getPercentileRank(currentCandle.volume, sortedVolumes);

    // Calculate volatility for dynamic threshold
    const volatility = this.calculateVolatility(historicalCandles);

    // Dynamic multiplier based on volatility
    const dynamicMultiplier =
      volatility > this.config.highVolatilityThreshold
        ? this.config.highVolatilityMultiplier
        : this.config.lowVolatilityMultiplier;

    const requiredVolume = avgVolume * dynamicMultiplier;
    const volumeRatio = avgVolume > 0 ? currentCandle.volume / avgVolume : 0;
    const isValid = currentCandle.volume >= requiredVolume;

    const reason = isValid
      ? `Volume confirmed: ${volumeRatio.toFixed(2)}x average (${percentileRank.toFixed(0)}th percentile)`
      : `Volume too low: ${volumeRatio.toFixed(2)}x average < ${dynamicMultiplier.toFixed(1)}x required`;

    return {
      isValid,
      currentVolume: currentCandle.volume,
      averageVolume: avgVolume,
      requiredVolume,
      volumeRatio,
      percentileRank,
      volatility,
      dynamicMultiplier,
      reason,
    };
  }

  /**
   * Calculate volatility using log returns
   */
  private calculateVolatility(candles: Candle[]): number {
    if (candles.length < 2) {
      return 0;
    }

    const returns = candles.slice(1).map((candle, i) => {
      const prevClose = candles[i].close;
      return prevClose > 0 ? Math.log(candle.close / prevClose) : 0;
    });

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;

    return Math.sqrt(variance);
  }

  /**
   * Get percentile rank of a value in a sorted array
   */
  private getPercentileRank(value: number, sortedArray: number[]): number {
    if (sortedArray.length === 0) {
      return 0;
    }

    let count = 0;
    for (const v of sortedArray) {
      if (v < value) {
        count++;
      } else {
        break;
      }
    }

    return (count / sortedArray.length) * 100;
  }

  /**
   * Get configuration
   */
  getConfig(): VolumeConfirmationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<VolumeConfirmationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export default VolumeConfirmation;
