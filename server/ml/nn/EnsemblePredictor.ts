/**
 * Ensemble Price Prediction System
 * 
 * Combines LSTM and Transformer predictions with weighted averaging
 * and confidence calibration for improved accuracy.
 */

import { LSTMPricePredictor, PredictionResult } from './LSTMPricePredictor';
import { TransformerPredictor, TransformerPrediction } from './TransformerPredictor';
import { getDb } from '../../db';
import { sql } from 'drizzle-orm';

export interface EnsembleConfig {
  lstmWeight: number;
  transformerWeight: number;
  confidenceThreshold: number;
  calibrationEnabled: boolean;
  adaptiveWeights: boolean;
}

export interface EnsemblePrediction {
  predictedPrice: number;
  predictedDirection: 'up' | 'down' | 'neutral';
  confidence: number;
  priceChange: number;
  
  // Individual model predictions
  lstmPrediction: PredictionResult;
  transformerPrediction: TransformerPrediction;
  
  // Ensemble metadata
  modelAgreement: boolean;
  weightedConfidence: number;
  calibratedConfidence: number;
  
  timestamp: Date;
  targetTimestamp: Date;
}

export interface PredictionAccuracy {
  modelType: 'lstm' | 'transformer' | 'ensemble';
  totalPredictions: number;
  correctDirections: number;
  avgPriceError: number;
  avgConfidence: number;
  calibrationScore: number;
}

export class EnsemblePredictor {
  private lstmModel: LSTMPricePredictor;
  private transformerModel: TransformerPredictor;
  private config: EnsembleConfig;
  private predictionHistory: Array<{
    prediction: EnsemblePrediction;
    actualPrice?: number;
    wasCorrect?: boolean;
  }> = [];
  private modelAccuracy: Map<string, PredictionAccuracy> = new Map();
  private updatesSinceLastSave: number = 0;
  private readonly AUTO_SAVE_INTERVAL = 10; // Save every 10 accuracy updates

  constructor(config: Partial<EnsembleConfig> = {}) {
    this.config = {
      lstmWeight: 0.5,
      transformerWeight: 0.5,
      confidenceThreshold: 0.6,
      calibrationEnabled: true,
      adaptiveWeights: true,
      ...config
    };
    
    this.lstmModel = new LSTMPricePredictor({
      inputSize: 10,
      hiddenSize: 64,
      numLayers: 2,
      sequenceLength: 60
    });
    
    this.transformerModel = new TransformerPredictor({
      inputSize: 10,
      modelDim: 64,
      numHeads: 4,
      numLayers: 2,
      sequenceLength: 60
    });
    
    this.initializeAccuracyTracking();
  }
  
  /**
   * Initialize accuracy tracking for all models
   */
  private initializeAccuracyTracking(): void {
    const models = ['lstm', 'transformer', 'ensemble'];
    for (const model of models) {
      this.modelAccuracy.set(model, {
        modelType: model as 'lstm' | 'transformer' | 'ensemble',
        totalPredictions: 0,
        correctDirections: 0,
        avgPriceError: 0,
        avgConfidence: 0,
        calibrationScore: 1.0
      });
    }
  }
  
  /**
   * Make ensemble prediction
   */
  predict(candles: Array<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>): EnsemblePrediction {
    // Get individual predictions
    const lstmPrediction = this.lstmModel.predict(candles);
    const transformerPrediction = this.transformerModel.predict(candles);
    
    // Get adaptive weights if enabled
    let lstmWeight = this.config.lstmWeight;
    let transformerWeight = this.config.transformerWeight;
    
    if (this.config.adaptiveWeights) {
      const weights = this.calculateAdaptiveWeights();
      lstmWeight = weights.lstm;
      transformerWeight = weights.transformer;
    }
    
    // Combine predictions
    const weightedPriceChange = 
      lstmPrediction.priceChange * lstmWeight + 
      transformerPrediction.priceChange * transformerWeight;
    
    const weightedConfidence = 
      lstmPrediction.confidence * lstmWeight + 
      transformerPrediction.confidence * transformerWeight;
    
    const currentPrice = candles[candles.length - 1].close;
    const predictedPrice = currentPrice * (1 + weightedPriceChange / 100);
    
    // Determine direction
    let predictedDirection: 'up' | 'down' | 'neutral';
    if (weightedPriceChange > 0.1) {
      predictedDirection = 'up';
    } else if (weightedPriceChange < -0.1) {
      predictedDirection = 'down';
    } else {
      predictedDirection = 'neutral';
    }
    
    // PHASE 10B: Enhanced ML ensemble disagreement handling
    const modelAgreement = lstmPrediction.predictedDirection === transformerPrediction.predictedDirection;
    
    // Calculate disagreement severity (0 = perfect agreement, 1 = max disagreement)
    const priceChangeDiff = Math.abs(lstmPrediction.priceChange - transformerPrediction.priceChange);
    const confidenceDiff = Math.abs(lstmPrediction.confidence - transformerPrediction.confidence);
    const directionDisagree = !modelAgreement ? 1 : 0;
    // Weighted disagreement: direction matters most (50%), price diff (30%), confidence diff (20%)
    const disagreementSeverity = Math.min(1, 
      directionDisagree * 0.5 + 
      Math.min(priceChangeDiff / 3, 1) * 0.3 + 
      confidenceDiff * 0.2
    );
    
    // Apply confidence adjustment based on disagreement severity
    let confidence = weightedConfidence;
    if (modelAgreement) {
      confidence = Math.min(1, confidence * 1.2);
    } else if (disagreementSeverity > 0.7) {
      // Severe disagreement: heavy penalty, signals should be treated with extreme caution
      confidence = confidence * 0.5;
      console.log(`[EnsemblePredictor] SEVERE model disagreement (${(disagreementSeverity * 100).toFixed(0)}%): LSTM=${lstmPrediction.predictedDirection}/${lstmPrediction.priceChange.toFixed(2)}%, Transformer=${transformerPrediction.predictedDirection}/${transformerPrediction.priceChange.toFixed(2)}%`);
    } else if (disagreementSeverity > 0.4) {
      // Moderate disagreement: standard penalty
      confidence = confidence * 0.7;
    } else {
      // Mild disagreement (same direction, different magnitude)
      confidence = confidence * 0.85;
    }
    
    // Apply calibration if enabled
    let calibratedConfidence = confidence;
    if (this.config.calibrationEnabled) {
      calibratedConfidence = this.calibrateConfidence(confidence);
    }
    
    const now = new Date();
    const targetTimestamp = new Date(now.getTime() + 60 * 60 * 1000);
    
    const prediction: EnsemblePrediction = {
      predictedPrice,
      predictedDirection,
      confidence,
      priceChange: weightedPriceChange,
      lstmPrediction,
      transformerPrediction,
      modelAgreement,
      weightedConfidence,
      calibratedConfidence,
      timestamp: now,
      targetTimestamp
    };
    
    // Store prediction for accuracy tracking
    this.predictionHistory.push({ prediction });
    
    return prediction;
  }
  
  /**
   * Calculate adaptive weights based on recent performance
   */
  private calculateAdaptiveWeights(): { lstm: number; transformer: number } {
    const lstmAccuracy = this.modelAccuracy.get('lstm');
    const transformerAccuracy = this.modelAccuracy.get('transformer');
    
    if (!lstmAccuracy || !transformerAccuracy || 
        lstmAccuracy.totalPredictions < 10 || transformerAccuracy.totalPredictions < 10) {
      return { lstm: 0.5, transformer: 0.5 };
    }
    
    // Calculate accuracy ratios
    const lstmScore = lstmAccuracy.correctDirections / lstmAccuracy.totalPredictions;
    const transformerScore = transformerAccuracy.correctDirections / transformerAccuracy.totalPredictions;
    
    // Normalize weights
    const total = lstmScore + transformerScore;
    if (total === 0) {
      return { lstm: 0.5, transformer: 0.5 };
    }
    
    return {
      lstm: lstmScore / total,
      transformer: transformerScore / total
    };
  }
  
  /**
   * Calibrate confidence based on historical accuracy
   */
  private calibrateConfidence(rawConfidence: number): number {
    const ensembleAccuracy = this.modelAccuracy.get('ensemble');
    if (!ensembleAccuracy || ensembleAccuracy.totalPredictions < 20) {
      return rawConfidence;
    }
    
    // Apply Platt scaling approximation
    const calibrationFactor = ensembleAccuracy.calibrationScore;
    return Math.min(1, rawConfidence * calibrationFactor);
  }
  
  /**
   * Update accuracy tracking with actual outcome
   */
  async updateWithActual(
    predictionTimestamp: Date,
    actualPrice: number,
    symbol: string
  ): Promise<void> {
    // Find matching prediction
    const historyEntry = this.predictionHistory.find(
      h => Math.abs(h.prediction.timestamp.getTime() - predictionTimestamp.getTime()) < 60000
    );
    
    if (!historyEntry) return;
    
    const prediction = historyEntry.prediction;
    const predictedPrice = prediction.predictedPrice;
    const priceError = Math.abs(actualPrice - predictedPrice) / actualPrice;
    
    // Determine if direction was correct
    const actualDirection = actualPrice > prediction.predictedPrice ? 'up' : 
                           actualPrice < prediction.predictedPrice ? 'down' : 'neutral';
    const wasCorrect = prediction.predictedDirection === actualDirection;
    
    historyEntry.actualPrice = actualPrice;
    historyEntry.wasCorrect = wasCorrect;
    
    // Update model accuracy
    this.updateModelAccuracy('ensemble', wasCorrect, priceError, prediction.confidence);
    
    // Update individual model accuracy
    const lstmCorrect = prediction.lstmPrediction.predictedDirection === actualDirection;
    const transformerCorrect = prediction.transformerPrediction.predictedDirection === actualDirection;
    
    this.updateModelAccuracy('lstm', lstmCorrect, priceError, prediction.lstmPrediction.confidence);
    this.updateModelAccuracy('transformer', transformerCorrect, priceError, prediction.transformerPrediction.confidence);
    
    // Save prediction result to database
    await this.savePredictionResult(prediction, actualPrice, wasCorrect, symbol);

    // Phase 6: Auto-save model weights after accuracy improvements
    this.updatesSinceLastSave++;
    if (this.updatesSinceLastSave >= this.AUTO_SAVE_INTERVAL) {
      this.updatesSinceLastSave = 0;
      await this.saveToDb(symbol).catch(err =>
        console.warn('[EnsemblePredictor] Auto-save failed:', err)
      );
    }
  }
  
  /**
   * Update accuracy metrics for a model
   */
  private updateModelAccuracy(
    modelType: string,
    wasCorrect: boolean,
    priceError: number,
    confidence: number
  ): void {
    const accuracy = this.modelAccuracy.get(modelType);
    if (!accuracy) return;
    
    accuracy.totalPredictions++;
    if (wasCorrect) accuracy.correctDirections++;
    
    // Update running averages
    const n = accuracy.totalPredictions;
    accuracy.avgPriceError = (accuracy.avgPriceError * (n - 1) + priceError) / n;
    accuracy.avgConfidence = (accuracy.avgConfidence * (n - 1) + confidence) / n;
    
    // Update calibration score
    const actualAccuracy = accuracy.correctDirections / accuracy.totalPredictions;
    if (accuracy.avgConfidence > 0) {
      accuracy.calibrationScore = actualAccuracy / accuracy.avgConfidence;
    }
  }
  
  /**
   * Save prediction result to database
   */
  private async savePredictionResult(
    prediction: EnsemblePrediction,
    actualPrice: number,
    wasCorrect: boolean,
    symbol: string
  ): Promise<void> {
    const db = await getDb();
    if (!db) return;
    
    const priceError = Math.abs(actualPrice - prediction.predictedPrice) / actualPrice * 100;
    const actualDirection = actualPrice > prediction.predictedPrice ? 'up' : 
                           actualPrice < prediction.predictedPrice ? 'down' : 'neutral';
    
    await db.execute(sql`
      INSERT INTO nnPredictions 
      (modelType, symbol, timeframe, predictionTimestamp, targetTimestamp,
       predictedPrice, predictedDirection, confidence, actualPrice, 
       actualDirection, predictionError, wasCorrect)
      VALUES (
        'ensemble', ${symbol}, '1h', ${prediction.timestamp}, ${prediction.targetTimestamp},
        ${prediction.predictedPrice}, ${prediction.predictedDirection}, ${prediction.confidence},
        ${actualPrice}, ${actualDirection}, ${priceError}, ${wasCorrect}
      )
    `);
  }
  
  /**
   * Train both models on historical data
   */
  async train(
    trainingData: Array<{
      features: number[][];
      target: number;
    }>,
    epochs: number = 100,
    onProgress?: (model: string, epoch: number, loss: number) => void
  ): Promise<{
    lstmLoss: number;
    transformerLoss: number;
  }> {
    // Train LSTM
    const lstmResult = await this.lstmModel.train(trainingData, epochs, (epoch, loss) => {
      if (onProgress) onProgress('lstm', epoch, loss);
    });
    
    // Train Transformer
    const transformerResult = await this.transformerModel.train(trainingData, epochs, (epoch, loss) => {
      if (onProgress) onProgress('transformer', epoch, loss);
    });
    
    return {
      lstmLoss: lstmResult.finalLoss,
      transformerLoss: transformerResult.finalLoss
    };
  }
  
  /**
   * Get model accuracy statistics
   */
  getAccuracyStats(): Map<string, PredictionAccuracy> {
    return new Map(this.modelAccuracy);
  }
  
  /**
   * Get prediction history
   */
  getPredictionHistory(): typeof this.predictionHistory {
    return [...this.predictionHistory];
  }
  
  /**
   * Get current model weights
   */
  getModelWeights(): { lstm: number; transformer: number } {
    if (this.config.adaptiveWeights) {
      return this.calculateAdaptiveWeights();
    }
    return {
      lstm: this.config.lstmWeight,
      transformer: this.config.transformerWeight
    };
  }
  
  /**
   * Serialize ensemble for saving
   */
  serialize(): string {
    return JSON.stringify({
      config: this.config,
      lstmModel: this.lstmModel.serialize(),
      transformerModel: this.transformerModel.serialize(),
      modelAccuracy: Array.from(this.modelAccuracy.entries())
    });
  }
  
  /**
   * Deserialize ensemble
   */
  static deserialize(data: string): EnsemblePredictor {
    const parsed = JSON.parse(data);
    const ensemble = new EnsemblePredictor(parsed.config);
    ensemble.lstmModel = LSTMPricePredictor.deserialize(parsed.lstmModel);
    ensemble.transformerModel = TransformerPredictor.deserialize(parsed.transformerModel);
    ensemble.modelAccuracy = new Map(parsed.modelAccuracy);
    return ensemble;
  }
  
  /**
   * Get LSTM model for direct access
   */
  getLSTMModel(): LSTMPricePredictor {
    return this.lstmModel;
  }
  
  /**
   * Get Transformer model for direct access
   */
  getTransformerModel(): TransformerPredictor {
    return this.transformerModel;
  }

  /**
   * Phase 6: Save model weights to database for persistence across restarts
   */
  async saveToDb(symbol: string = 'BTC-USD'): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const configKey = `ml_ensemble_weights_${symbol}`;
    const serialized = this.serialize();

    try {
      // Check if entry exists
      const rows = await db.execute(sql`
        SELECT id FROM systemConfig WHERE userId = 1 AND configKey = ${configKey} LIMIT 1
      `);
      const existing = (rows as any[])[0] as any[];

      if (existing && existing.length > 0) {
        await db.execute(sql`
          UPDATE systemConfig SET configValue = ${serialized} WHERE id = ${existing[0].id}
        `);
      } else {
        await db.execute(sql`
          INSERT INTO systemConfig (userId, configKey, configValue, description)
          VALUES (1, ${configKey}, ${serialized}, ${'EnsemblePredictor model weights'})
        `);
      }

      const accuracy = this.modelAccuracy.get('ensemble');
      const totalPreds = accuracy?.totalPredictions || 0;
      const correctPreds = accuracy?.correctDirections || 0;
      console.log(`[EnsemblePredictor] Model saved for ${symbol} (${totalPreds} predictions, ${correctPreds} correct)`);
    } catch (error) {
      console.error('[EnsemblePredictor] Failed to save model:', error);
    }
  }

  /**
   * Phase 6: Load persisted model weights from database
   */
  async loadFromDb(symbol: string = 'BTC-USD'): Promise<boolean> {
    const db = await getDb();
    if (!db) return false;

    const configKey = `ml_ensemble_weights_${symbol}`;

    try {
      const rows = await db.execute(sql`
        SELECT configValue FROM systemConfig WHERE userId = 1 AND configKey = ${configKey} LIMIT 1
      `);
      const results = (rows as any[])[0] as any[];

      if (!results || results.length === 0) return false;

      const serialized = typeof results[0].configValue === 'string'
        ? results[0].configValue
        : JSON.stringify(results[0].configValue);

      const loaded = EnsemblePredictor.deserialize(serialized);

      // Copy loaded state into this instance
      this.lstmModel = loaded.lstmModel;
      this.transformerModel = loaded.transformerModel;
      this.modelAccuracy = loaded.modelAccuracy;
      this.config = loaded.config;

      const accuracy = this.modelAccuracy.get('ensemble');
      console.log(`[EnsemblePredictor] Loaded persisted model for ${symbol} (${accuracy?.totalPredictions || 0} predictions tracked)`);
      return true;
    } catch (error) {
      console.error('[EnsemblePredictor] Failed to load model:', error);
      return false;
    }
  }
}

export default EnsemblePredictor;
