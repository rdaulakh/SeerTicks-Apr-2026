/**
 * ML Prediction Agent
 * 
 * Wraps the EnsemblePredictor (LSTM + Transformer) to provide
 * trading signals based on ML price predictions.
 * 
 * This agent integrates neural network predictions into the
 * consensus-based trading system.
 */

import { AgentBase, AgentSignal, AgentConfig } from './AgentBase';
import { getActiveClock } from '../_core/clock';
import { EnsemblePredictor, EnsemblePrediction } from '../ml/nn/EnsemblePredictor';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';

export interface MLPredictionConfig extends AgentConfig {
  predictionHorizon: number; // Minutes ahead to predict
  minConfidenceThreshold: number; // Minimum confidence to generate signal
  priceChangeThreshold: number; // Minimum price change % to act
  useAdaptiveWeights: boolean; // Use adaptive LSTM/Transformer weights
}

// Candle buffer storage per symbol
const candleBuffers: Map<string, Array<{
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>> = new Map();

const REQUIRED_CANDLES = 30; // Lowered from 60 for faster signal generation

export class MLPredictionAgent extends AgentBase {
  private ensemblePredictor: EnsemblePredictor;
  private mlConfig: MLPredictionConfig;
  private lastPrediction: EnsemblePrediction | null = null;
  private predictionAccuracy: { correct: number; total: number } = { correct: 0, total: 0 };

  constructor(config: Partial<MLPredictionConfig> = {}) {
    super({
      name: 'MLPredictionAgent',
      enabled: true,
      updateInterval: 60000, // 1 minute
      timeout: 30000,
      maxRetries: 3,
      ...config
    });

    this.mlConfig = {
      name: 'MLPredictionAgent',
      enabled: true,
      updateInterval: 60000,
      timeout: 30000,
      maxRetries: 3,
      predictionHorizon: 60, // 1 hour ahead
      minConfidenceThreshold: 0.6,
      priceChangeThreshold: 0.5, // 0.5% minimum move
      useAdaptiveWeights: true,
      ...config
    } as MLPredictionConfig;

    this.ensemblePredictor = new EnsemblePredictor({
      lstmWeight: 0.5,
      transformerWeight: 0.5,
      confidenceThreshold: this.mlConfig.minConfidenceThreshold,
      calibrationEnabled: true,
      adaptiveWeights: this.mlConfig.useAdaptiveWeights
    });
  }

  /**
   * Initialize agent resources
   * Phase 6: Load persisted model weights and candle buffer from database
   */
  protected async initialize(): Promise<void> {
    console.log(`[MLPredictionAgent] Initializing ML prediction agent...`);

    // Load persisted model weights
    try {
      const loaded = await this.ensemblePredictor.loadFromDb('BTC-USD');
      if (loaded) {
        console.log(`[MLPredictionAgent] Loaded persisted ensemble model`);
      } else {
        console.log(`[MLPredictionAgent] No persisted model found, starting with fresh weights`);
      }
    } catch (err) {
      console.warn(`[MLPredictionAgent] Failed to load persisted model:`, err);
    }

    // Load persisted candle buffer
    try {
      const db = await getDb();
      if (db) {
        const rows = await db.execute(sql`
          SELECT configValue FROM systemConfig WHERE userId = 1 AND configKey = 'ml_candle_buffer_BTC-USD' LIMIT 1
        `);
        const results = (rows as any[])[0] as any[];
        if (results && results.length > 0) {
          const candles = typeof results[0].configValue === 'string'
            ? JSON.parse(results[0].configValue)
            : results[0].configValue;
          if (Array.isArray(candles) && candles.length > 0) {
            candleBuffers.set('BTC-USD', candles.slice(-REQUIRED_CANDLES));
            console.log(`[MLPredictionAgent] Loaded ${candles.length} persisted candles for BTC-USD`);
          }
        }
      }
    } catch (err) {
      console.warn(`[MLPredictionAgent] Failed to load candle buffer:`, err);
    }
  }

  /**
   * Cleanup agent resources
   */
  protected async cleanup(): Promise<void> {
    console.log(`[MLPredictionAgent] Cleaning up ML prediction agent...`);
  }

  /**
   * Periodic update (not used for this agent)
   */
  protected async periodicUpdate(): Promise<void> {
    // No periodic updates needed - signals are generated on demand
  }

  /**
   * Analyze market data and generate ML-based signal
   */
  protected async analyze(symbol: string, context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();

    try {
      // Get or create candle buffer for this symbol
      let candleBuffer = candleBuffers.get(symbol) || [];

      // Update candle buffer with context data if available
      if (context?.ohlcv && context.ohlcv.length > 0) {
        candleBuffer = context.ohlcv.slice(-REQUIRED_CANDLES).map((candle: any) => ({
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume
        }));
        candleBuffers.set(symbol, candleBuffer);
      } else if (context?.price) {
        // Create synthetic candle from current price
        const candle = {
          open: context.price,
          high: context.price,
          low: context.price,
          close: context.price,
          volume: context.volume || 0
        };
        candleBuffer.push(candle);
        if (candleBuffer.length > REQUIRED_CANDLES) {
          candleBuffer = candleBuffer.slice(-REQUIRED_CANDLES);
        }
        candleBuffers.set(symbol, candleBuffer);
      }

      // Phase 6: Periodically persist candle buffer (every 10 candles)
      if (candleBuffer.length > 0 && candleBuffer.length % 10 === 0) {
        this.persistCandleBuffer(symbol, candleBuffer).catch(() => {});
      }

      // Check if we have enough data
      if (candleBuffer.length < REQUIRED_CANDLES) {
        return this.createInsufficientDataSignal(
          symbol,
          `Insufficient data: ${candleBuffer.length}/${REQUIRED_CANDLES} candles`,
          startTime,
          context
        );
      }

      // Get ensemble prediction
      const prediction = this.ensemblePredictor.predict(candleBuffer);
      this.lastPrediction = prediction;

      // Convert prediction to trading signal
      const signal = this.predictionToSignal(prediction, symbol, context?.price || candleBuffer[candleBuffer.length - 1].close, startTime, context);

      // Log prediction for accuracy tracking
      await this.logPrediction(prediction, symbol);

      return signal;
    } catch (error) {
      console.error(`[MLPredictionAgent] Analysis error:`, error);
      return this.createNeutralSignal(
        symbol,
        `Analysis error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Create signal for insufficient data - Enhanced fallback with momentum analysis
   */
  private createInsufficientDataSignal(symbol: string, reason: string, startTime: number, context?: any): AgentSignal {
    const candleBuffer = candleBuffers.get(symbol) || [];
    
    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.45;
    let strength = 0.4;
    let bullishScore = 0;
    let bearishScore = 0;
    const reasons: string[] = [`[ML MOMENTUM FALLBACK] ${reason}`];
    
    // Multi-factor momentum analysis
    
    // Factor 1: Short-term candle trend (if available)
    if (candleBuffer.length >= 3) {
      const recentCandles = candleBuffer.slice(-Math.min(10, candleBuffer.length));
      const firstClose = recentCandles[0].close;
      const lastClose = recentCandles[recentCandles.length - 1].close;
      const priceChange = ((lastClose - firstClose) / firstClose) * 100;
      
      if (priceChange > 0.8) {
        bullishScore += 2;
        confidence += 0.08;
        reasons.push(`Candle trend: +${priceChange.toFixed(2)}%`);
      } else if (priceChange < -0.8) {
        bearishScore += 2;
        confidence += 0.08;
        reasons.push(`Candle trend: ${priceChange.toFixed(2)}%`);
      }
      
      // Check for momentum acceleration
      if (recentCandles.length >= 5) {
        const midPoint = Math.floor(recentCandles.length / 2);
        const firstHalfChange = ((recentCandles[midPoint].close - recentCandles[0].close) / recentCandles[0].close) * 100;
        const secondHalfChange = ((lastClose - recentCandles[midPoint].close) / recentCandles[midPoint].close) * 100;
        
        if (secondHalfChange > firstHalfChange && secondHalfChange > 0.5) {
          bullishScore += 1;
          reasons.push('Momentum accelerating');
        } else if (secondHalfChange < firstHalfChange && secondHalfChange < -0.5) {
          bearishScore += 1;
          reasons.push('Momentum decelerating');
        }
      }
      
      // Volume analysis
      const volumes = recentCandles.map(c => c.volume);
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const recentVolume = volumes.slice(-3).reduce((a, b) => a + b, 0) / 3;
      
      if (recentVolume > avgVolume * 1.3) {
        confidence += 0.05;
        if (priceChange > 0) bullishScore += 1;
        else if (priceChange < 0) bearishScore += 1;
        reasons.push(`Volume spike: ${((recentVolume / avgVolume) * 100).toFixed(0)}% of avg`);
      }
    }
    
    // Factor 2: 24h price change from context
    if (context?.priceChange24h !== undefined) {
      if (context.priceChange24h > 2) {
        bullishScore += 2;
        confidence += 0.1;
        reasons.push(`24h momentum: +${context.priceChange24h.toFixed(2)}%`);
      } else if (context.priceChange24h > 1) {
        bullishScore += 1;
        confidence += 0.05;
        reasons.push(`24h slight bullish: +${context.priceChange24h.toFixed(2)}%`);
      } else if (context.priceChange24h < -2) {
        bearishScore += 2;
        confidence += 0.1;
        reasons.push(`24h momentum: ${context.priceChange24h.toFixed(2)}%`);
      } else if (context.priceChange24h < -1) {
        bearishScore += 1;
        confidence += 0.05;
        reasons.push(`24h slight bearish: ${context.priceChange24h.toFixed(2)}%`);
      }
    }
    
    // Factor 3: Price position in range
    if (context?.high24h && context?.low24h && context?.currentPrice) {
      const range = context.high24h - context.low24h;
      const positionInRange = range > 0 ? (context.currentPrice - context.low24h) / range : 0.5;
      
      if (positionInRange > 0.75) {
        bullishScore += 1;
        reasons.push(`Near 24h high (${(positionInRange * 100).toFixed(0)}%)`);
      } else if (positionInRange < 0.25) {
        bearishScore += 1;
        reasons.push(`Near 24h low (${(positionInRange * 100).toFixed(0)}%)`);
      }
    }
    
    // Factor 4: Volume trend
    if (context?.volume24h && context?.volumeChange24h) {
      if (context.volumeChange24h > 50 && context.priceChange24h > 0) {
        bullishScore += 1;
        reasons.push('High volume with rising price');
      } else if (context.volumeChange24h > 50 && context.priceChange24h < 0) {
        bearishScore += 1;
        reasons.push('High volume with falling price');
      }
    }
    
    // Determine final signal - lowered thresholds for more directional signals
    if (bullishScore > bearishScore && bullishScore >= 2) {
      signal = 'bullish';
      strength = 0.5 + (bullishScore - bearishScore) * 0.08;
    } else if (bearishScore > bullishScore && bearishScore >= 2) {
      signal = 'bearish';
      strength = 0.5 + (bearishScore - bullishScore) * 0.08;
    } else if (bullishScore > bearishScore && bullishScore >= 1) {
      signal = 'bullish';
      strength = 0.45;
    } else if (bearishScore > bullishScore && bearishScore >= 1) {
      signal = 'bearish';
      strength = 0.45;
    }
    
    confidence = Math.max(0.4, Math.min(0.75, confidence));
    strength = Math.max(0.35, Math.min(0.7, strength));
    
    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength,
      executionScore: 40 + bullishScore * 5 + bearishScore * 5,
      reasoning: reasons.join(' | '),
      evidence: { 
        insufficientData: true,
        candlesAvailable: candleBuffer.length,
        candlesRequired: REQUIRED_CANDLES,
        fallbackUsed: true,
        bullishScore,
        bearishScore,
        momentumAnalysis: true
      },
      qualityScore: 0.5,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0
    };
  }

  /**
   * Convert ML prediction to trading signal
   */
  private predictionToSignal(
    prediction: EnsemblePrediction,
    symbol: string,
    currentPrice: number,
    startTime: number,
    context?: any
  ): AgentSignal {
    const processingTime = getActiveClock().now() - startTime;

    // Check confidence threshold
    if (prediction.calibratedConfidence < this.mlConfig.minConfidenceThreshold) {
      return {
        agentName: this.config.name,
        symbol,
        timestamp: getActiveClock().now(),
        signal: 'neutral',
        confidence: prediction.calibratedConfidence,
        strength: 0,
        executionScore: 50,
        reasoning: `ML confidence ${(prediction.calibratedConfidence * 100).toFixed(1)}% below threshold ${(this.mlConfig.minConfidenceThreshold * 100).toFixed(1)}%`,
        evidence: this.getPredictionEvidence(prediction),
        qualityScore: prediction.calibratedConfidence,
        processingTime,
        dataFreshness: 0
      };
    }

    // Check price change threshold
    if (Math.abs(prediction.priceChange) < this.mlConfig.priceChangeThreshold) {
      return {
        agentName: this.config.name,
        symbol,
        timestamp: getActiveClock().now(),
        signal: 'neutral',
        confidence: prediction.calibratedConfidence,
        strength: Math.abs(prediction.priceChange) / this.mlConfig.priceChangeThreshold,
        executionScore: 50,
        reasoning: `Predicted price change ${prediction.priceChange.toFixed(2)}% below threshold ${this.mlConfig.priceChangeThreshold}%`,
        evidence: this.getPredictionEvidence(prediction),
        qualityScore: prediction.calibratedConfidence,
        processingTime,
        dataFreshness: 0
      };
    }

    // Determine signal direction
    let signal: 'bullish' | 'bearish' | 'neutral';
    let reasoning: string;

    if (prediction.predictedDirection === 'up') {
      signal = 'bullish';
      reasoning = this.buildBullishReasoning(prediction);
    } else if (prediction.predictedDirection === 'down') {
      signal = 'bearish';
      reasoning = this.buildBearishReasoning(prediction);
    } else {
      signal = 'neutral';
      reasoning = 'ML models predict sideways movement';
    }

    // Boost confidence if models agree
    let finalConfidence = prediction.calibratedConfidence;
    if (prediction.modelAgreement) {
      finalConfidence = Math.min(1, finalConfidence * 1.1);
      reasoning += ' | LSTM and Transformer models AGREE';
    } else {
      reasoning += ' | Models DISAGREE (reduced confidence)';
    }

    // Phase 30: Apply MarketContext regime adjustments
    if (context?.regime) {
      const regime = context.regime as string;
      // ML predictions are more reliable in trending markets
      if ((regime === 'trending_up' || regime === 'trending_down') && prediction.modelAgreement) {
        finalConfidence = Math.min(0.95, finalConfidence * 1.08);
        reasoning += ` [Regime: ${regime} — ML trend prediction boosted]`;
      }
      // In high volatility, ML predictions are less reliable
      if (regime === 'high_volatility') {
        finalConfidence *= 0.85;
        reasoning += ' [Regime: high_volatility — ML prediction dampened]';
      }
      // In range-bound, mean-reversion predictions are stronger
      if (regime === 'range_bound' || regime === 'mean_reverting') {
        finalConfidence = Math.min(0.95, finalConfidence * 1.05);
        reasoning += ` [Regime: ${regime} — ML reversion prediction boosted]`;
      }
    }

    // Calculate execution score based on confidence and model agreement
    const executionScore = Math.round(
      (finalConfidence * 60) + 
      (prediction.modelAgreement ? 25 : 10) + 
      (Math.min(Math.abs(prediction.priceChange), 5) * 3)
    );

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence: finalConfidence,
      strength: Math.min(1, Math.abs(prediction.priceChange) / 5), // Normalize to 0-1
      executionScore: Math.min(100, executionScore),
      reasoning,
      evidence: this.getPredictionEvidence(prediction),
      qualityScore: finalConfidence,
      processingTime,
      dataFreshness: 0,
      recommendation: {
        action: signal === 'bullish' ? 'buy' : signal === 'bearish' ? 'sell' : 'hold',
        urgency: finalConfidence > 0.8 ? 'high' : finalConfidence > 0.6 ? 'medium' : 'low',
        targetPrice: prediction.predictedPrice
      }
    };
  }

  /**
   * Build bullish reasoning string
   */
  private buildBullishReasoning(prediction: EnsemblePrediction): string {
    const parts = [
      `ML Ensemble predicts BULLISH: +${prediction.priceChange.toFixed(2)}% expected`,
      `Target: $${prediction.predictedPrice.toFixed(2)}`,
      `Confidence: ${(prediction.calibratedConfidence * 100).toFixed(1)}%`
    ];

    if (prediction.lstmPrediction.predictedDirection === 'up') {
      parts.push(`LSTM: +${prediction.lstmPrediction.priceChange.toFixed(2)}%`);
    }
    if (prediction.transformerPrediction.predictedDirection === 'up') {
      parts.push(`Transformer: +${prediction.transformerPrediction.priceChange.toFixed(2)}%`);
    }

    return parts.join(' | ');
  }

  /**
   * Build bearish reasoning string
   */
  private buildBearishReasoning(prediction: EnsemblePrediction): string {
    const parts = [
      `ML Ensemble predicts BEARISH: ${prediction.priceChange.toFixed(2)}% expected`,
      `Target: $${prediction.predictedPrice.toFixed(2)}`,
      `Confidence: ${(prediction.calibratedConfidence * 100).toFixed(1)}%`
    ];

    if (prediction.lstmPrediction.predictedDirection === 'down') {
      parts.push(`LSTM: ${prediction.lstmPrediction.priceChange.toFixed(2)}%`);
    }
    if (prediction.transformerPrediction.predictedDirection === 'down') {
      parts.push(`Transformer: ${prediction.transformerPrediction.priceChange.toFixed(2)}%`);
    }

    return parts.join(' | ');
  }

  /**
   * Get prediction evidence for signal
   */
  private getPredictionEvidence(prediction: EnsemblePrediction): Record<string, any> {
    return {
      predictedPrice: prediction.predictedPrice,
      predictedDirection: prediction.predictedDirection,
      priceChange: prediction.priceChange,
      confidence: prediction.confidence,
      calibratedConfidence: prediction.calibratedConfidence,
      modelAgreement: prediction.modelAgreement,
      lstm: {
        direction: prediction.lstmPrediction.predictedDirection,
        confidence: prediction.lstmPrediction.confidence,
        priceChange: prediction.lstmPrediction.priceChange
      },
      transformer: {
        direction: prediction.transformerPrediction.predictedDirection,
        confidence: prediction.transformerPrediction.confidence,
        priceChange: prediction.transformerPrediction.priceChange
      }
    };
  }

  /**
   * Log prediction to database for accuracy tracking
   */
  private async logPrediction(prediction: EnsemblePrediction, symbol: string): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;

      // Use a simple insert - table may not exist yet
      await db.execute(sql`
        INSERT IGNORE INTO mlPredictionLogs 
        (symbol, predictionTimestamp, predictedPrice, predictedDirection, 
         confidence, calibratedConfidence, modelAgreement, lstmDirection, 
         transformerDirection, priceChange)
        VALUES (
          ${symbol}, ${prediction.timestamp}, ${prediction.predictedPrice},
          ${prediction.predictedDirection}, ${prediction.confidence},
          ${prediction.calibratedConfidence}, ${prediction.modelAgreement},
          ${prediction.lstmPrediction.predictedDirection},
          ${prediction.transformerPrediction.predictedDirection},
          ${prediction.priceChange}
        )
      `).catch(() => {
        // Table may not exist - silently fail
      });
    } catch (error) {
      // Silently fail - logging shouldn't break trading
    }
  }

  /**
   * Train the ensemble model on historical data
   */
  async train(
    trainingData: Array<{ features: number[][]; target: number }>,
    epochs: number = 100,
    onProgress?: (model: string, epoch: number, loss: number) => void
  ): Promise<{ lstmLoss: number; transformerLoss: number }> {
    return this.ensemblePredictor.train(trainingData, epochs, onProgress);
  }

  /**
   * Get model accuracy statistics
   */
  getAccuracyStats(): {
    agentAccuracy: { correct: number; total: number };
    modelAccuracy: Map<string, any>;
    modelWeights: { lstm: number; transformer: number };
  } {
    return {
      agentAccuracy: this.predictionAccuracy,
      modelAccuracy: this.ensemblePredictor.getAccuracyStats(),
      modelWeights: this.ensemblePredictor.getModelWeights()
    };
  }

  /**
   * Get last prediction
   */
  getLastPrediction(): EnsemblePrediction | null {
    return this.lastPrediction;
  }

  /**
   * Get the ensemble predictor for direct access
   */
  getEnsemblePredictor(): EnsemblePredictor {
    return this.ensemblePredictor;
  }

  /**
   * Serialize agent state
   */
  serialize(): string {
    return JSON.stringify({
      config: this.mlConfig,
      ensemble: this.ensemblePredictor.serialize(),
      accuracy: this.predictionAccuracy
    });
  }

  /**
   * Phase 6: Persist candle buffer to database for survival across restarts
   */
  private async persistCandleBuffer(symbol: string, candles: any[]): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const configKey = `ml_candle_buffer_${symbol}`;
    const value = JSON.stringify(candles.slice(-REQUIRED_CANDLES * 2)); // Keep 2x buffer

    try {
      const rows = await db.execute(sql`
        SELECT id FROM systemConfig WHERE userId = 1 AND configKey = ${configKey} LIMIT 1
      `);
      const existing = (rows as any[])[0] as any[];

      if (existing && existing.length > 0) {
        await db.execute(sql`
          UPDATE systemConfig SET configValue = ${value} WHERE id = ${existing[0].id}
        `);
      } else {
        await db.execute(sql`
          INSERT INTO systemConfig (userId, configKey, configValue, description)
          VALUES (1, ${configKey}, ${value}, ${'MLPredictionAgent candle buffer'})
        `);
      }
    } catch {
      // Non-fatal — don't break trading for persistence failure
    }
  }

  /**
   * Deserialize agent state
   */
  static deserialize(data: string): MLPredictionAgent {
    const parsed = JSON.parse(data);
    const agent = new MLPredictionAgent(parsed.config);
    agent.ensemblePredictor = EnsemblePredictor.deserialize(parsed.ensemble);
    agent.predictionAccuracy = parsed.accuracy;
    return agent;
  }
}

export default MLPredictionAgent;
