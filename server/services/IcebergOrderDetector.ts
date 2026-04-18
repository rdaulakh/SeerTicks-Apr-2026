/**
 * Iceberg Order Detector (Priority 1)
 * 
 * Detects hidden institutional orders (iceberg orders) by analyzing:
 * 1. Repeated same-size orders at similar price levels
 * 2. Consistent execution patterns indicating algorithmic trading
 * 3. Large cumulative volume from seemingly small orders
 * 
 * Iceberg orders are used by institutions to hide large positions.
 * Detecting them early can prevent 10-15% additional losses.
 */

export interface Trade {
  price: number;
  size: number;
  side: 'buy' | 'sell';
  timestamp: number;
}

export interface IcebergPattern {
  detected: boolean;
  confidence: number;
  direction: 'buy' | 'sell' | null;
  estimatedTotalSize: number;
  averageChunkSize: number;
  priceRange: { min: number; max: number };
  timeSpanMs: number;
  chunkCount: number;
  reason: string;
}

export interface IcebergSignal {
  symbol: string;
  direction: 'bullish' | 'bearish';
  confidence: number;
  estimatedSize: number;
  priceLevel: number;
  timestamp: number;
}

export interface IcebergConfig {
  minChunkCount: number;        // Minimum repeated orders to detect pattern
  sizeTolerancePercent: number; // Tolerance for "same size" detection
  priceTolerancePercent: number;// Tolerance for price clustering
  timeWindowMs: number;         // Time window to analyze
  minConfidence: number;        // Minimum confidence to report detection
}

const DEFAULT_CONFIG: IcebergConfig = {
  minChunkCount: 4,             // Need at least 4 similar orders
  sizeTolerancePercent: 0.10,   // 10% size tolerance
  priceTolerancePercent: 0.005, // 0.5% price tolerance
  timeWindowMs: 300000,         // 5 minute window
  minConfidence: 0.65,          // 65% confidence threshold
};

export class IcebergOrderDetector {
  private config: IcebergConfig;
  private recentPatterns: Map<string, IcebergPattern[]> = new Map();

  constructor(config?: Partial<IcebergConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect iceberg pattern from recent trades
   */
  detectIcebergPattern(symbol: string, trades: Trade[]): IcebergPattern {
    if (trades.length < this.config.minChunkCount) {
      return this.createEmptyPattern('Insufficient trades for analysis');
    }

    // Filter trades within time window
    const now = Date.now();
    const recentTrades = trades.filter(t => now - t.timestamp < this.config.timeWindowMs);
    
    if (recentTrades.length < this.config.minChunkCount) {
      return this.createEmptyPattern('Insufficient recent trades');
    }

    // Analyze buy and sell sides separately
    const buyTrades = recentTrades.filter(t => t.side === 'buy');
    const sellTrades = recentTrades.filter(t => t.side === 'sell');

    const buyPattern = this.analyzeOneSide(buyTrades, 'buy');
    const sellPattern = this.analyzeOneSide(sellTrades, 'sell');

    // Return the stronger pattern
    if (buyPattern.confidence > sellPattern.confidence) {
      this.recordPattern(symbol, buyPattern);
      return buyPattern;
    } else {
      this.recordPattern(symbol, sellPattern);
      return sellPattern;
    }
  }

  /**
   * Analyze trades on one side for iceberg pattern
   */
  private analyzeOneSide(trades: Trade[], side: 'buy' | 'sell'): IcebergPattern {
    if (trades.length < this.config.minChunkCount) {
      return this.createEmptyPattern(`Insufficient ${side} trades`);
    }

    // Group trades by similar size
    const sizeGroups = this.groupBySimilarSize(trades);
    
    // Find the largest group (most repeated size)
    let largestGroup: Trade[] = [];
    for (const group of sizeGroups.values()) {
      if (group.length > largestGroup.length) {
        largestGroup = group;
      }
    }

    if (largestGroup.length < this.config.minChunkCount) {
      return this.createEmptyPattern('No significant size clustering detected');
    }

    // Calculate pattern metrics
    const avgSize = largestGroup.reduce((sum, t) => sum + t.size, 0) / largestGroup.length;
    const totalSize = largestGroup.reduce((sum, t) => sum + t.size, 0);
    const prices = largestGroup.map(t => t.price);
    const priceMin = Math.min(...prices);
    const priceMax = Math.max(...prices);
    const timestamps = largestGroup.map(t => t.timestamp);
    const timeSpan = Math.max(...timestamps) - Math.min(...timestamps);

    // Calculate confidence based on multiple factors
    const sizeConsistency = this.calculateSizeConsistency(largestGroup);
    const priceConsistency = this.calculatePriceConsistency(largestGroup);
    const timeConsistency = this.calculateTimeConsistency(largestGroup);
    const volumeSignificance = Math.min(1, largestGroup.length / 10); // More chunks = higher confidence

    const confidence = (sizeConsistency * 0.35 + priceConsistency * 0.25 + 
                       timeConsistency * 0.20 + volumeSignificance * 0.20);

    const detected = confidence >= this.config.minConfidence;

    return {
      detected,
      confidence,
      direction: side,
      estimatedTotalSize: totalSize,
      averageChunkSize: avgSize,
      priceRange: { min: priceMin, max: priceMax },
      timeSpanMs: timeSpan,
      chunkCount: largestGroup.length,
      reason: detected 
        ? `Detected ${largestGroup.length} similar ${side} orders averaging ${avgSize.toFixed(4)} units`
        : `Pattern confidence (${(confidence * 100).toFixed(1)}%) below threshold`,
    };
  }

  /**
   * Group trades by similar size
   */
  private groupBySimilarSize(trades: Trade[]): Map<number, Trade[]> {
    const groups = new Map<number, Trade[]>();
    const tolerance = this.config.sizeTolerancePercent;

    for (const trade of trades) {
      let foundGroup = false;
      
      for (const [baseSize, group] of groups.entries()) {
        const diff = Math.abs(trade.size - baseSize) / baseSize;
        if (diff <= tolerance) {
          group.push(trade);
          foundGroup = true;
          break;
        }
      }

      if (!foundGroup) {
        groups.set(trade.size, [trade]);
      }
    }

    return groups;
  }

  /**
   * Calculate how consistent the trade sizes are
   */
  private calculateSizeConsistency(trades: Trade[]): number {
    if (trades.length < 2) return 0;
    
    const sizes = trades.map(t => t.size);
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const variance = sizes.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / sizes.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean; // Coefficient of variation
    
    // Lower CV = higher consistency (0 = perfect, 1+ = high variance)
    return Math.max(0, 1 - cv);
  }

  /**
   * Calculate how clustered the prices are
   */
  private calculatePriceConsistency(trades: Trade[]): number {
    if (trades.length < 2) return 0;
    
    const prices = trades.map(t => t.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const range = Math.max(...prices) - Math.min(...prices);
    const rangePercent = range / mean;
    
    // Smaller range = higher consistency
    return Math.max(0, 1 - (rangePercent / this.config.priceTolerancePercent));
  }

  /**
   * Calculate time distribution consistency (regular intervals = algorithmic)
   */
  private calculateTimeConsistency(trades: Trade[]): number {
    if (trades.length < 3) return 0;
    
    const timestamps = trades.map(t => t.timestamp).sort((a, b) => a - b);
    const intervals: number[] = [];
    
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }
    
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, i) => sum + Math.pow(i - mean, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean;
    
    // Regular intervals suggest algorithmic execution
    return Math.max(0, 1 - cv);
  }

  /**
   * Generate trading signal from iceberg detection
   */
  generateSignal(symbol: string, trades: Trade[]): IcebergSignal | null {
    const pattern = this.detectIcebergPattern(symbol, trades);
    
    if (!pattern.detected || !pattern.direction) {
      return null;
    }

    const avgPrice = (pattern.priceRange.min + pattern.priceRange.max) / 2;

    return {
      symbol,
      direction: pattern.direction === 'buy' ? 'bullish' : 'bearish',
      confidence: pattern.confidence,
      estimatedSize: pattern.estimatedTotalSize,
      priceLevel: avgPrice,
      timestamp: Date.now(),
    };
  }

  /**
   * Get recent patterns for a symbol
   */
  getRecentPatterns(symbol: string): IcebergPattern[] {
    return this.recentPatterns.get(symbol) || [];
  }

  /**
   * Record a detected pattern
   */
  private recordPattern(symbol: string, pattern: IcebergPattern): void {
    if (!pattern.detected) return;
    
    const patterns = this.recentPatterns.get(symbol) || [];
    patterns.push(pattern);
    
    // Keep only last 10 patterns
    if (patterns.length > 10) {
      patterns.shift();
    }
    
    this.recentPatterns.set(symbol, patterns);
  }

  /**
   * Create empty pattern for non-detection cases
   */
  private createEmptyPattern(reason: string): IcebergPattern {
    return {
      detected: false,
      confidence: 0,
      direction: null,
      estimatedTotalSize: 0,
      averageChunkSize: 0,
      priceRange: { min: 0, max: 0 },
      timeSpanMs: 0,
      chunkCount: 0,
      reason,
    };
  }

  /**
   * Clear all recorded patterns
   */
  clearPatterns(): void {
    this.recentPatterns.clear();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<IcebergConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export default IcebergOrderDetector;
