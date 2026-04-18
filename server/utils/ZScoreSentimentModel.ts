/**
 * Z-Score Sentiment Model
 * 
 * This model fixes the SentimentAnalyst's 99.8% bullish bias by using
 * statistical normalization instead of raw Fear & Greed values.
 * 
 * Key Features:
 * 1. Maintains rolling window of historical Fear & Greed values
 * 2. Calculates Z-score to identify statistically significant deviations
 * 3. Only generates signals when deviation exceeds threshold (default 1.5 std dev)
 * 4. Uses contrarian logic: extreme fear = bullish, extreme greed = bearish
 * 
 * Expected Signal Distribution:
 * - Bullish: ~15-25% (only during extreme fear)
 * - Bearish: ~15-25% (only during extreme greed)
 * - Neutral: ~50-70% (normal market conditions)
 */

export interface ZScoreResult {
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  zScore: number;
  mean: number;
  stdDev: number;
  isStatisticallySignificant: boolean;
  reasoning: string;
}

export interface ZScoreModelConfig {
  windowSize: number;      // Rolling window size (default: 30 days)
  signalThreshold: number; // Z-score threshold for signal generation (default: 1.5)
  minSamples: number;      // Minimum samples before generating signals (default: 7)
  maxConfidence: number;   // Maximum confidence cap (default: 0.75)
}

interface FearGreedHistoryEntry {
  value: number;
  timestamp: number;
}

export class ZScoreSentimentModel {
  private config: ZScoreModelConfig;
  private fearGreedHistory: FearGreedHistoryEntry[] = [];
  private socialSentimentHistory: number[] = [];

  constructor(config?: Partial<ZScoreModelConfig>) {
    this.config = {
      windowSize: config?.windowSize ?? 30,
      signalThreshold: config?.signalThreshold ?? 1.5,
      minSamples: config?.minSamples ?? 7,
      maxConfidence: config?.maxConfidence ?? 0.75,
    };
  }

  /**
   * Initialize model with historical Fear & Greed data
   */
  public initializeWithHistory(history: FearGreedHistoryEntry[]): void {
    // Sort by timestamp (oldest first)
    this.fearGreedHistory = history
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-this.config.windowSize);
    
    console.log(`[ZScoreSentimentModel] Initialized with ${this.fearGreedHistory.length} historical samples`);
  }

  /**
   * Add a new Fear & Greed value to the rolling window
   */
  public addFearGreedValue(value: number, timestamp?: number): void {
    this.fearGreedHistory.push({
      value,
      timestamp: timestamp ?? Date.now(),
    });

    // Maintain window size
    if (this.fearGreedHistory.length > this.config.windowSize) {
      this.fearGreedHistory.shift();
    }
  }

  /**
   * Calculate Z-score for a Fear & Greed value
   */
  public calculateFearGreedZScore(currentValue: number): ZScoreResult {
    const values = this.fearGreedHistory.map(h => h.value);
    
    // Check minimum samples
    if (values.length < this.config.minSamples) {
      return {
        signal: 'neutral',
        confidence: 0,
        zScore: 0,
        mean: 50,
        stdDev: 0,
        isStatisticallySignificant: false,
        reasoning: `Insufficient data: ${values.length}/${this.config.minSamples} samples. Returning neutral.`,
      };
    }

    // Calculate statistics
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Avoid division by zero
    if (stdDev === 0) {
      return {
        signal: 'neutral',
        confidence: 0,
        zScore: 0,
        mean,
        stdDev: 0,
        isStatisticallySignificant: false,
        reasoning: `No variance in data (all values = ${mean}). Returning neutral.`,
      };
    }

    // Calculate Z-score
    const zScore = (currentValue - mean) / stdDev;
    const absZScore = Math.abs(zScore);
    const isStatisticallySignificant = absZScore >= this.config.signalThreshold;

    // Determine signal using CONTRARIAN logic
    // Low Z-score (extreme fear) = bullish opportunity
    // High Z-score (extreme greed) = bearish warning
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0;
    let reasoning = '';

    if (!isStatisticallySignificant) {
      reasoning = `Fear & Greed Index (${currentValue}) is within normal range (Z=${zScore.toFixed(2)}, threshold=±${this.config.signalThreshold}). Market sentiment is neutral.`;
    } else if (zScore < -this.config.signalThreshold) {
      // Extreme fear = bullish (contrarian)
      signal = 'bullish';
      confidence = Math.min(this.config.maxConfidence, (absZScore - this.config.signalThreshold) / 2);
      reasoning = `Extreme fear detected (F&G=${currentValue}, Z=${zScore.toFixed(2)}). Contrarian bullish signal - historically, extreme fear precedes recoveries.`;
    } else if (zScore > this.config.signalThreshold) {
      // Extreme greed = bearish (contrarian)
      signal = 'bearish';
      confidence = Math.min(this.config.maxConfidence, (absZScore - this.config.signalThreshold) / 2);
      reasoning = `Extreme greed detected (F&G=${currentValue}, Z=${zScore.toFixed(2)}). Contrarian bearish signal - historically, extreme greed precedes corrections.`;
    }

    return {
      signal,
      confidence,
      zScore,
      mean,
      stdDev,
      isStatisticallySignificant,
      reasoning,
    };
  }

  /**
   * Calculate combined Z-score from Fear & Greed and Social Sentiment
   */
  public calculateCombinedZScore(
    fearGreedValue: number | null,
    socialSentiment: number // -1 to +1
  ): ZScoreResult {
    // If no Fear & Greed data, use social sentiment only
    if (fearGreedValue === null) {
      return this.calculateSocialSentimentSignal(socialSentiment);
    }

    // Get Fear & Greed Z-score
    const fgResult = this.calculateFearGreedZScore(fearGreedValue);

    // Convert social sentiment to signal
    const socialSignal = this.interpretSocialSentiment(socialSentiment);

    // Combine signals
    if (!fgResult.isStatisticallySignificant) {
      // Fear & Greed is neutral, use social sentiment
      if (Math.abs(socialSentiment) > 0.5) {
        return {
          ...fgResult,
          signal: socialSentiment > 0.5 ? 'bullish' : socialSentiment < -0.5 ? 'bearish' : 'neutral',
          confidence: Math.min(this.config.maxConfidence, Math.abs(socialSentiment) * 0.5),
          reasoning: `${fgResult.reasoning} Social sentiment (${(socialSentiment * 100).toFixed(0)}%) provides directional bias.`,
        };
      }
      return fgResult;
    }

    // Both have signals - check for confirmation or divergence
    if (fgResult.signal === socialSignal && socialSignal !== 'neutral') {
      // Confirmation - boost confidence
      return {
        ...fgResult,
        confidence: Math.min(this.config.maxConfidence, fgResult.confidence * 1.3),
        reasoning: `${fgResult.reasoning} Social sentiment (${(socialSentiment * 100).toFixed(0)}%) confirms the ${fgResult.signal} bias.`,
      };
    } else if (fgResult.signal !== socialSignal && socialSignal !== 'neutral' && fgResult.signal !== 'neutral') {
      // Divergence - reduce confidence
      return {
        ...fgResult,
        confidence: Math.max(0, fgResult.confidence * 0.6),
        reasoning: `${fgResult.reasoning} WARNING: Social sentiment (${(socialSentiment * 100).toFixed(0)}%) diverges from Fear & Greed signal. Reduced confidence.`,
      };
    }

    return fgResult;
  }

  /**
   * Interpret social sentiment value
   */
  private interpretSocialSentiment(sentiment: number): 'bullish' | 'bearish' | 'neutral' {
    if (sentiment > 0.3) return 'bullish';
    if (sentiment < -0.3) return 'bearish';
    return 'neutral';
  }

  /**
   * Calculate signal from social sentiment only
   */
  private calculateSocialSentimentSignal(sentiment: number): ZScoreResult {
    const signal = this.interpretSocialSentiment(sentiment);
    const confidence = signal === 'neutral' ? 0 : Math.min(this.config.maxConfidence, Math.abs(sentiment) * 0.5);

    return {
      signal,
      confidence,
      zScore: sentiment * 2, // Approximate Z-score from sentiment
      mean: 0,
      stdDev: 1,
      isStatisticallySignificant: Math.abs(sentiment) > 0.5,
      reasoning: `Social sentiment only: ${(sentiment * 100).toFixed(0)}% → ${signal} signal.`,
    };
  }

  /**
   * Get model statistics
   */
  public getStatistics(): {
    fearGreedSamples: number;
    fearGreedMean: number;
    fearGreedStdDev: number;
    lastValue: number | null;
  } {
    const values = this.fearGreedHistory.map(h => h.value);
    const mean = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const variance = values.length > 0 
      ? values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length 
      : 0;

    return {
      fearGreedSamples: values.length,
      fearGreedMean: mean,
      fearGreedStdDev: Math.sqrt(variance),
      lastValue: values.length > 0 ? values[values.length - 1] : null,
    };
  }

  /**
   * Reset the model
   */
  public reset(): void {
    this.fearGreedHistory = [];
    this.socialSentimentHistory = [];
  }
}

// Singleton instance
let zScoreModelInstance: ZScoreSentimentModel | null = null;

export function getZScoreSentimentModel(): ZScoreSentimentModel {
  if (!zScoreModelInstance) {
    zScoreModelInstance = new ZScoreSentimentModel();
  }
  return zScoreModelInstance;
}

export default ZScoreSentimentModel;
