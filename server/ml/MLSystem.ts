/**
 * ML System - Native TypeScript Trade Success Predictor
 *
 * Phase 6: Replaced Python bridge (non-existent XGBoost script) with
 * a native logistic regression model with feature interactions.
 *
 * Provides:
 * - Trade success probability prediction
 * - Online learning from trade outcomes
 * - Model persistence via database
 * - Feature importance tracking
 */

import { getDb } from '../db';
import { systemConfig } from '../../drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

export interface MLFeatures {
  // Agent signals (18 features)
  technical_confidence: number;
  technical_strength: number;
  technical_quality: number;
  pattern_confidence: number;
  pattern_strength: number;
  pattern_quality: number;
  orderflow_confidence: number;
  orderflow_strength: number;
  orderflow_quality: number;
  sentiment_confidence: number;
  sentiment_strength: number;
  sentiment_quality: number;
  news_confidence: number;
  news_strength: number;
  news_quality: number;
  macro_confidence: number;
  macro_strength: number;
  macro_quality: number;

  // Pattern metrics (3 features)
  pattern_alpha: number;
  pattern_similarity: number;
  pattern_times_used: number;

  // Consensus metrics (3 features)
  consensus_score: number;
  consensus_confidence: number;
  agreeing_agents: number;

  // Market conditions (6 features)
  volatility: number;
  volume_ratio: number;
  trend_strength: number;
  rsi: number;
  macd: number;
  bb_position: number;

  // Risk metrics (3 features)
  risk_reward_ratio: number;
  position_size: number;
  expected_return: number;

  // Macro indicators (4 features)
  vix: number;
  dxy: number;
  sp500_change: number;
  stablecoin_change: number;
}

export interface SuccessPrediction {
  successProbability: number;
  confidence: number;
  modelAvailable: boolean;
}

export interface TrainingResult {
  accuracy: number;
  auc: number;
  trainSamples: number;
  testSamples: number;
}

export interface TrainingDataPoint {
  features: MLFeatures;
  was_successful: boolean;
  quality_weight: number;
}

// Feature names in consistent order for model weight mapping
const FEATURE_NAMES: (keyof MLFeatures)[] = [
  'technical_confidence', 'technical_strength', 'technical_quality',
  'pattern_confidence', 'pattern_strength', 'pattern_quality',
  'orderflow_confidence', 'orderflow_strength', 'orderflow_quality',
  'sentiment_confidence', 'sentiment_strength', 'sentiment_quality',
  'news_confidence', 'news_strength', 'news_quality',
  'macro_confidence', 'macro_strength', 'macro_quality',
  'pattern_alpha', 'pattern_similarity', 'pattern_times_used',
  'consensus_score', 'consensus_confidence', 'agreeing_agents',
  'volatility', 'volume_ratio', 'trend_strength', 'rsi', 'macd', 'bb_position',
  'risk_reward_ratio', 'position_size', 'expected_return',
  'vix', 'dxy', 'sp500_change', 'stablecoin_change',
];

// Interaction feature pairs (features that multiply together for non-linear effects)
const INTERACTION_PAIRS: [keyof MLFeatures, keyof MLFeatures][] = [
  ['consensus_score', 'consensus_confidence'],       // High consensus + high confidence
  ['technical_confidence', 'orderflow_confidence'],   // Technical + orderflow agreement
  ['volatility', 'risk_reward_ratio'],                // Vol-adjusted R:R
  ['trend_strength', 'consensus_score'],              // Trend-aligned consensus
  ['rsi', 'bb_position'],                             // RSI + BB position interaction
  ['agreeing_agents', 'consensus_confidence'],         // More agreement = higher quality
];

interface ModelWeights {
  weights: number[];        // One per feature + interactions + bias
  featureMeans: number[];   // For standardization
  featureStds: number[];    // For standardization
  trainingSamples: number;
  baseRate: number;         // Historical win rate as prior
  version: number;
}

/**
 * Native TypeScript Trade Success Predictor
 *
 * Logistic regression with feature interactions, L2 regularization,
 * and quality-weighted training. Replaces the Python XGBoost bridge.
 */
export class TradeSuccessPredictor {
  private weights: number[] | null = null;
  private featureMeans: number[] = [];
  private featureStds: number[] = [];
  private trainingSamples: number = 0;
  private baseRate: number = 0.5;
  private version: number = 0;
  private readonly MIN_SAMPLES = 30;
  private readonly FEATURE_COUNT: number;
  private readonly DB_CONFIG_KEY = 'ml_trade_success_model';
  private readonly SYSTEM_USER_ID = 1;
  private loaded: boolean = false;

  constructor() {
    // Total features = raw features + interaction features
    this.FEATURE_COUNT = FEATURE_NAMES.length + INTERACTION_PAIRS.length;
  }

  /**
   * Predict trade success probability
   */
  async predictSuccess(features: MLFeatures): Promise<SuccessPrediction> {
    // Try loading model if not yet loaded
    if (!this.loaded) {
      await this.loadFromDb();
    }

    if (!this.weights || this.trainingSamples < this.MIN_SAMPLES) {
      // Not enough training data — use base rate
      return {
        successProbability: this.baseRate,
        confidence: 0,
        modelAvailable: false,
      };
    }

    const featureVector = this.buildFeatureVector(features);
    const standardized = this.standardize(featureVector);

    // Add bias term
    const withBias = [...standardized, 1.0];

    // Logistic regression: sigmoid(w · x)
    const logit = this.dot(this.weights, withBias);
    const probability = this.sigmoid(logit);

    // Confidence based on how far from 0.5 and how much training data we have
    const distanceFromUncertain = Math.abs(probability - 0.5) * 2; // 0-1
    const dataCoverage = Math.min(1.0, this.trainingSamples / 200); // Ramp up to 200 samples
    const confidence = distanceFromUncertain * dataCoverage;

    return {
      successProbability: probability,
      confidence,
      modelAvailable: true,
    };
  }

  /**
   * Train model on historical trade data
   * Uses mini-batch gradient descent with L2 regularization
   */
  async trainPathSuccessPredictor(trainingData: TrainingDataPoint[]): Promise<TrainingResult> {
    if (trainingData.length < this.MIN_SAMPLES) {
      return { accuracy: 0, auc: 0, trainSamples: trainingData.length, testSamples: 0 };
    }

    // Split into train/test (80/20)
    const shuffled = [...trainingData].sort(() => Math.random() - 0.5);
    const splitIdx = Math.floor(shuffled.length * 0.8);
    const trainSet = shuffled.slice(0, splitIdx);
    const testSet = shuffled.slice(splitIdx);

    // Build feature matrices
    const trainFeatures = trainSet.map(d => this.buildFeatureVector(d.features));
    const trainLabels = trainSet.map(d => d.was_successful ? 1 : 0);
    const trainWeights = trainSet.map(d => d.quality_weight || 1.0);

    // Compute feature statistics for standardization
    this.computeFeatureStats(trainFeatures);

    // Standardize
    const trainStandardized = trainFeatures.map(f => this.standardize(f));

    // Initialize weights (small random for symmetry breaking)
    const numWeights = this.FEATURE_COUNT + 1; // +1 for bias
    this.weights = new Array(numWeights).fill(0).map(() => (Math.random() - 0.5) * 0.01);

    // Training hyperparameters
    const learningRate = 0.01;
    const l2Lambda = 0.001;
    const epochs = 100;
    const batchSize = Math.min(32, trainSet.length);

    // Calculate base rate
    const positives = trainLabels.filter(l => l === 1).length;
    this.baseRate = positives / trainLabels.length;

    // Mini-batch gradient descent
    for (let epoch = 0; epoch < epochs; epoch++) {
      // Shuffle training data each epoch
      const indices = Array.from({ length: trainSet.length }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      for (let batchStart = 0; batchStart < trainSet.length; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, trainSet.length);
        const gradients = new Array(numWeights).fill(0);
        let batchWeightSum = 0;

        for (let b = batchStart; b < batchEnd; b++) {
          const idx = indices[b];
          const x = [...trainStandardized[idx], 1.0]; // Add bias
          const y = trainLabels[idx];
          const w = trainWeights[idx];

          const prediction = this.sigmoid(this.dot(this.weights, x));
          const error = prediction - y;

          for (let k = 0; k < numWeights; k++) {
            gradients[k] += error * x[k] * w;
          }
          batchWeightSum += w;
        }

        // Update weights with L2 regularization
        if (batchWeightSum > 0) {
          for (let k = 0; k < numWeights; k++) {
            const grad = gradients[k] / batchWeightSum;
            const l2Penalty = k < numWeights - 1 ? l2Lambda * this.weights[k] : 0; // No L2 on bias
            this.weights[k] -= learningRate * (grad + l2Penalty);
          }
        }
      }
    }

    this.trainingSamples = trainingData.length;
    this.version++;

    // Evaluate on test set
    const testFeatures = testSet.map(d => this.buildFeatureVector(d.features));
    const testLabels = testSet.map(d => d.was_successful ? 1 : 0);
    const testStandardized = testFeatures.map(f => this.standardize(f));

    let correct = 0;
    const predictions: number[] = [];

    for (let i = 0; i < testSet.length; i++) {
      const x = [...testStandardized[i], 1.0];
      const prob = this.sigmoid(this.dot(this.weights, x));
      predictions.push(prob);
      const predicted = prob >= 0.5 ? 1 : 0;
      if (predicted === testLabels[i]) correct++;
    }

    const accuracy = testSet.length > 0 ? correct / testSet.length : 0;
    const auc = this.calculateAUC(predictions, testLabels);

    console.log(`[TradeSuccessPredictor] Training complete: ${trainingData.length} samples, accuracy=${(accuracy * 100).toFixed(1)}%, AUC=${auc.toFixed(3)}, baseRate=${(this.baseRate * 100).toFixed(1)}%`);

    return {
      accuracy,
      auc,
      trainSamples: trainSet.length,
      testSamples: testSet.length,
    };
  }

  /**
   * Get feature importance scores (absolute weight magnitudes)
   */
  getFeatureImportance(): Record<string, number> {
    if (!this.weights) return {};

    const importance: Record<string, number> = {};

    // Raw features
    for (let i = 0; i < FEATURE_NAMES.length; i++) {
      importance[FEATURE_NAMES[i]] = Math.abs(this.weights[i] || 0);
    }

    // Interaction features
    for (let i = 0; i < INTERACTION_PAIRS.length; i++) {
      const [f1, f2] = INTERACTION_PAIRS[i];
      const key = `${f1}*${f2}`;
      importance[key] = Math.abs(this.weights[FEATURE_NAMES.length + i] || 0);
    }

    return importance;
  }

  /**
   * Save model to database
   */
  async saveToDb(): Promise<void> {
    if (!this.weights) return;

    const db = await getDb();
    if (!db) return;

    const modelData: ModelWeights = {
      weights: this.weights,
      featureMeans: this.featureMeans,
      featureStds: this.featureStds,
      trainingSamples: this.trainingSamples,
      baseRate: this.baseRate,
      version: this.version,
    };

    try {
      // Upsert: try update first, then insert if not found
      const existing = await db.select().from(systemConfig)
        .where(and(
          eq(systemConfig.userId, this.SYSTEM_USER_ID),
          eq(systemConfig.configKey, this.DB_CONFIG_KEY),
        ))
        .limit(1);

      if (existing.length > 0) {
        await db.update(systemConfig)
          .set({ configValue: modelData as any })
          .where(eq(systemConfig.id, existing[0].id));
      } else {
        await db.insert(systemConfig).values({
          userId: this.SYSTEM_USER_ID,
          configKey: this.DB_CONFIG_KEY,
          configValue: modelData as any,
          description: 'ML Trade Success Predictor model weights',
        });
      }

      console.log(`[TradeSuccessPredictor] Model saved (v${this.version}, ${this.trainingSamples} samples)`);
    } catch (error) {
      console.error('[TradeSuccessPredictor] Failed to save model:', error);
    }
  }

  /**
   * Load model from database
   */
  async loadFromDb(): Promise<boolean> {
    this.loaded = true; // Mark as loaded attempt even if it fails

    const db = await getDb();
    if (!db) return false;

    try {
      const rows = await db.select().from(systemConfig)
        .where(and(
          eq(systemConfig.userId, this.SYSTEM_USER_ID),
          eq(systemConfig.configKey, this.DB_CONFIG_KEY),
        ))
        .limit(1);

      if (rows.length === 0) return false;

      const modelData = rows[0].configValue as unknown as ModelWeights;
      if (!modelData || !modelData.weights) return false;

      this.weights = modelData.weights;
      this.featureMeans = modelData.featureMeans || [];
      this.featureStds = modelData.featureStds || [];
      this.trainingSamples = modelData.trainingSamples || 0;
      this.baseRate = modelData.baseRate || 0.5;
      this.version = modelData.version || 0;

      console.log(`[TradeSuccessPredictor] Loaded model v${this.version} (${this.trainingSamples} samples, baseRate=${(this.baseRate * 100).toFixed(1)}%)`);
      return true;
    } catch (error) {
      console.error('[TradeSuccessPredictor] Failed to load model:', error);
      return false;
    }
  }

  // ---- Private helpers ----

  private buildFeatureVector(features: MLFeatures): number[] {
    const raw: number[] = FEATURE_NAMES.map(name => features[name] || 0);

    // Add interaction features
    const interactions: number[] = INTERACTION_PAIRS.map(([f1, f2]) =>
      (features[f1] || 0) * (features[f2] || 0)
    );

    return [...raw, ...interactions];
  }

  private computeFeatureStats(featureVectors: number[][]): void {
    if (featureVectors.length === 0) return;
    const n = featureVectors[0].length;

    this.featureMeans = new Array(n).fill(0);
    this.featureStds = new Array(n).fill(1);

    // Calculate means
    for (const fv of featureVectors) {
      for (let i = 0; i < n; i++) {
        this.featureMeans[i] += fv[i];
      }
    }
    for (let i = 0; i < n; i++) {
      this.featureMeans[i] /= featureVectors.length;
    }

    // Calculate stds
    for (const fv of featureVectors) {
      for (let i = 0; i < n; i++) {
        this.featureStds[i] += (fv[i] - this.featureMeans[i]) ** 2;
      }
    }
    for (let i = 0; i < n; i++) {
      this.featureStds[i] = Math.sqrt(this.featureStds[i] / featureVectors.length);
      if (this.featureStds[i] < 1e-8) this.featureStds[i] = 1; // Prevent division by zero
    }
  }

  private standardize(featureVector: number[]): number[] {
    if (this.featureMeans.length === 0) return featureVector;
    return featureVector.map((v, i) => (v - (this.featureMeans[i] || 0)) / (this.featureStds[i] || 1));
  }

  private sigmoid(x: number): number {
    if (x > 20) return 1;
    if (x < -20) return 0;
    return 1 / (1 + Math.exp(-x));
  }

  private dot(a: number[], b: number[]): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  /**
   * Calculate AUC-ROC using the trapezoidal rule
   */
  private calculateAUC(predictions: number[], labels: number[]): number {
    if (predictions.length === 0) return 0;

    // Sort by prediction descending
    const pairs = predictions.map((p, i) => ({ pred: p, label: labels[i] }));
    pairs.sort((a, b) => b.pred - a.pred);

    const totalPositive = labels.filter(l => l === 1).length;
    const totalNegative = labels.length - totalPositive;

    if (totalPositive === 0 || totalNegative === 0) return 0.5;

    let auc = 0;
    let truePositiveRate = 0;
    let prevFalsePositiveRate = 0;
    let tp = 0;
    let fp = 0;

    for (const { label } of pairs) {
      if (label === 1) {
        tp++;
      } else {
        fp++;
        const newTPR = tp / totalPositive;
        const newFPR = fp / totalNegative;
        // Trapezoidal rule
        auc += (newFPR - prevFalsePositiveRate) * (newTPR + truePositiveRate) / 2;
        truePositiveRate = newTPR;
        prevFalsePositiveRate = newFPR;
      }
    }

    // Final segment to (1, 1)
    auc += (1 - prevFalsePositiveRate) * (1 + truePositiveRate) / 2;

    return auc;
  }
}

// Backward-compatible aliases
export class MLSystem extends TradeSuccessPredictor {}

// Singleton instance
let predictorInstance: TradeSuccessPredictor | null = null;

export function getMLSystem(): TradeSuccessPredictor {
  if (!predictorInstance) {
    predictorInstance = new TradeSuccessPredictor();
  }
  return predictorInstance;
}

export function getTradeSuccessPredictor(): TradeSuccessPredictor {
  return getMLSystem();
}
