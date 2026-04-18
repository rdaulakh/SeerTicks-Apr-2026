/**
 * Transformer Price Prediction Model
 * 
 * Implements self-attention based Transformer for price prediction.
 * Pure TypeScript implementation with multi-head attention.
 */

export interface TransformerConfig {
  inputSize: number;          // Number of features per timestep
  modelDim: number;           // Model dimension (d_model)
  numHeads: number;           // Number of attention heads
  numLayers: number;          // Number of transformer layers
  ffnDim: number;             // Feed-forward network dimension
  sequenceLength: number;     // Input sequence length
  outputSize: number;         // Prediction output size
  learningRate: number;
  dropoutRate: number;
}

export interface TransformerPrediction {
  predictedPrice: number;
  predictedDirection: 'up' | 'down' | 'neutral';
  confidence: number;
  priceChange: number;
  attentionWeights: number[][]; // Attention visualization
  timestamp: Date;
  targetTimestamp: Date;
}

interface AttentionWeights {
  Wq: number[][];
  Wk: number[][];
  Wv: number[][];
  Wo: number[][];
}

interface FFNWeights {
  W1: number[][];
  b1: number[];
  W2: number[][];
  b2: number[];
}

interface TransformerLayer {
  attention: AttentionWeights;
  ffn: FFNWeights;
  layerNorm1Scale: number[];
  layerNorm1Bias: number[];
  layerNorm2Scale: number[];
  layerNorm2Bias: number[];
}

export class TransformerPredictor {
  private config: TransformerConfig;
  private inputProjection: number[][] = [];
  private inputBias: number[] = [];
  private positionalEncoding: number[][] = [];
  private layers: TransformerLayer[] = [];
  private outputWeights: number[][] = [];
  private outputBias: number[] = [];
  private trainingHistory: { loss: number; epoch: number }[] = [];
  private lastAttentionWeights: number[][] = [];
  
  constructor(config: Partial<TransformerConfig> = {}) {
    this.config = {
      inputSize: 10,
      modelDim: 64,
      numHeads: 4,
      numLayers: 2,
      ffnDim: 128,
      sequenceLength: 60,
      outputSize: 1,
      learningRate: 0.001,
      dropoutRate: 0.1,
      ...config
    };
    
    this.initializeWeights();
  }
  
  /**
   * Initialize all transformer weights
   */
  private initializeWeights(): void {
    const { inputSize, modelDim, numHeads, numLayers, ffnDim, sequenceLength, outputSize } = this.config;
    
    // Input projection
    const inputScale = Math.sqrt(2.0 / (inputSize + modelDim));
    this.inputProjection = this.randomMatrix(modelDim, inputSize, inputScale);
    this.inputBias = new Array(modelDim).fill(0);
    
    // Positional encoding (sinusoidal)
    this.positionalEncoding = this.createPositionalEncoding(sequenceLength, modelDim);
    
    // Transformer layers
    const headDim = Math.floor(modelDim / numHeads);
    const attentionScale = Math.sqrt(2.0 / (modelDim + headDim));
    const ffnScale1 = Math.sqrt(2.0 / (modelDim + ffnDim));
    const ffnScale2 = Math.sqrt(2.0 / (ffnDim + modelDim));
    
    for (let i = 0; i < numLayers; i++) {
      this.layers.push({
        attention: {
          Wq: this.randomMatrix(modelDim, modelDim, attentionScale),
          Wk: this.randomMatrix(modelDim, modelDim, attentionScale),
          Wv: this.randomMatrix(modelDim, modelDim, attentionScale),
          Wo: this.randomMatrix(modelDim, modelDim, attentionScale)
        },
        ffn: {
          W1: this.randomMatrix(ffnDim, modelDim, ffnScale1),
          b1: new Array(ffnDim).fill(0),
          W2: this.randomMatrix(modelDim, ffnDim, ffnScale2),
          b2: new Array(modelDim).fill(0)
        },
        layerNorm1Scale: new Array(modelDim).fill(1),
        layerNorm1Bias: new Array(modelDim).fill(0),
        layerNorm2Scale: new Array(modelDim).fill(1),
        layerNorm2Bias: new Array(modelDim).fill(0)
      });
    }
    
    // Output layer
    const outputScale = Math.sqrt(2.0 / (modelDim + outputSize));
    this.outputWeights = this.randomMatrix(outputSize, modelDim, outputScale);
    this.outputBias = new Array(outputSize).fill(0);
  }
  
  /**
   * Create sinusoidal positional encoding
   */
  private createPositionalEncoding(seqLen: number, dim: number): number[][] {
    const encoding: number[][] = [];
    
    for (let pos = 0; pos < seqLen; pos++) {
      const posEncoding: number[] = [];
      for (let i = 0; i < dim; i++) {
        const angle = pos / Math.pow(10000, (2 * Math.floor(i / 2)) / dim);
        if (i % 2 === 0) {
          posEncoding.push(Math.sin(angle));
        } else {
          posEncoding.push(Math.cos(angle));
        }
      }
      encoding.push(posEncoding);
    }
    
    return encoding;
  }
  
  /**
   * Create random matrix
   */
  private randomMatrix(rows: number, cols: number, scale: number): number[][] {
    const matrix: number[][] = [];
    for (let i = 0; i < rows; i++) {
      const row: number[] = [];
      for (let j = 0; j < cols; j++) {
        row.push((Math.random() * 2 - 1) * scale);
      }
      matrix.push(row);
    }
    return matrix;
  }
  
  /**
   * Matrix-vector multiplication
   */
  private matVec(matrix: number[][], vector: number[]): number[] {
    return matrix.map(row => 
      row.reduce((sum, val, i) => sum + val * (vector[i] || 0), 0)
    );
  }
  
  /**
   * Matrix-matrix multiplication
   */
  private matMul(a: number[][], b: number[][]): number[][] {
    const result: number[][] = [];
    for (let i = 0; i < a.length; i++) {
      const row: number[] = [];
      for (let j = 0; j < b[0].length; j++) {
        let sum = 0;
        for (let k = 0; k < b.length; k++) {
          sum += a[i][k] * b[k][j];
        }
        row.push(sum);
      }
      result.push(row);
    }
    return result;
  }
  
  /**
   * Transpose matrix
   */
  private transpose(matrix: number[][]): number[][] {
    if (matrix.length === 0) return [];
    return matrix[0].map((_, i) => matrix.map(row => row[i]));
  }
  
  /**
   * Softmax over rows
   */
  private softmax(matrix: number[][]): number[][] {
    return matrix.map(row => {
      const maxVal = Math.max(...row);
      const expValues = row.map(v => Math.exp(v - maxVal));
      const sumExp = expValues.reduce((sum, v) => sum + v, 0);
      return expValues.map(v => v / sumExp);
    });
  }
  
  /**
   * GELU activation
   */
  private gelu(x: number): number {
    return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * Math.pow(x, 3))));
  }
  
  /**
   * Layer normalization
   */
  private layerNorm(x: number[], scale: number[], bias: number[]): number[] {
    const mean = x.reduce((sum, v) => sum + v, 0) / x.length;
    const variance = x.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / x.length;
    const std = Math.sqrt(variance + 1e-6);
    
    return x.map((v, i) => scale[i] * (v - mean) / std + bias[i]);
  }
  
  /**
   * Multi-head self-attention
   */
  private multiHeadAttention(
    x: number[][],
    weights: AttentionWeights
  ): { output: number[][]; attentionWeights: number[][] } {
    const seqLen = x.length;
    const { numHeads, modelDim } = this.config;
    const headDim = Math.floor(modelDim / numHeads);
    
    // Project to Q, K, V
    const Q = x.map(vec => this.matVec(weights.Wq, vec));
    const K = x.map(vec => this.matVec(weights.Wk, vec));
    const V = x.map(vec => this.matVec(weights.Wv, vec));
    
    // Split into heads and compute attention
    const allHeadOutputs: number[][][] = [];
    let combinedAttention: number[][] = [];
    
    for (let h = 0; h < numHeads; h++) {
      const startIdx = h * headDim;
      const endIdx = startIdx + headDim;
      
      // Extract head projections
      const Qh = Q.map(q => q.slice(startIdx, endIdx));
      const Kh = K.map(k => k.slice(startIdx, endIdx));
      const Vh = V.map(v => v.slice(startIdx, endIdx));
      
      // Compute attention scores
      const scores: number[][] = [];
      for (let i = 0; i < seqLen; i++) {
        const scoreRow: number[] = [];
        for (let j = 0; j < seqLen; j++) {
          let score = 0;
          for (let d = 0; d < headDim; d++) {
            score += Qh[i][d] * Kh[j][d];
          }
          scoreRow.push(score / Math.sqrt(headDim));
        }
        scores.push(scoreRow);
      }
      
      // Apply softmax
      const attentionWeights = this.softmax(scores);
      
      if (h === 0) {
        combinedAttention = attentionWeights;
      }
      
      // Apply attention to values
      const headOutput: number[][] = [];
      for (let i = 0; i < seqLen; i++) {
        const output: number[] = new Array(headDim).fill(0);
        for (let j = 0; j < seqLen; j++) {
          for (let d = 0; d < headDim; d++) {
            output[d] += attentionWeights[i][j] * Vh[j][d];
          }
        }
        headOutput.push(output);
      }
      
      allHeadOutputs.push(headOutput);
    }
    
    // Concatenate heads
    const concatenated: number[][] = [];
    for (let i = 0; i < seqLen; i++) {
      const concat: number[] = [];
      for (let h = 0; h < numHeads; h++) {
        concat.push(...allHeadOutputs[h][i]);
      }
      // Pad if necessary
      while (concat.length < modelDim) {
        concat.push(0);
      }
      concatenated.push(concat.slice(0, modelDim));
    }
    
    // Output projection
    const output = concatenated.map(vec => this.matVec(weights.Wo, vec));
    
    return { output, attentionWeights: combinedAttention };
  }
  
  /**
   * Feed-forward network
   */
  private feedForward(x: number[], weights: FFNWeights): number[] {
    // First linear + GELU
    const hidden = this.matVec(weights.W1, x).map((v, i) => this.gelu(v + weights.b1[i]));
    
    // Second linear
    return this.matVec(weights.W2, hidden).map((v, i) => v + weights.b2[i]);
  }
  
  /**
   * Forward pass through transformer
   */
  private forward(sequence: number[][]): number[] {
    // Input projection
    let x = sequence.map((vec, i) => {
      const projected = this.matVec(this.inputProjection, vec).map((v, j) => v + this.inputBias[j]);
      // Add positional encoding
      return projected.map((v, j) => v + (this.positionalEncoding[i]?.[j] || 0));
    });
    
    // Transformer layers
    for (const layer of this.layers) {
      // Multi-head attention with residual
      const { output: attentionOutput, attentionWeights } = this.multiHeadAttention(x, layer.attention);
      this.lastAttentionWeights = attentionWeights;
      
      // Add & Norm
      x = x.map((vec, i) => {
        const residual = vec.map((v, j) => v + attentionOutput[i][j]);
        return this.layerNorm(residual, layer.layerNorm1Scale, layer.layerNorm1Bias);
      });
      
      // Feed-forward with residual
      const ffnOutput = x.map(vec => this.feedForward(vec, layer.ffn));
      
      // Add & Norm
      x = x.map((vec, i) => {
        const residual = vec.map((v, j) => v + ffnOutput[i][j]);
        return this.layerNorm(residual, layer.layerNorm2Scale, layer.layerNorm2Bias);
      });
    }
    
    // Global average pooling over sequence
    const pooled: number[] = new Array(this.config.modelDim).fill(0);
    for (const vec of x) {
      for (let i = 0; i < vec.length; i++) {
        pooled[i] += vec[i] / x.length;
      }
    }
    
    // Output projection
    return this.matVec(this.outputWeights, pooled).map((v, i) => v + this.outputBias[i]);
  }
  
  /**
   * Prepare features from candle data
   */
  prepareFeatures(candles: Array<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>): number[][] {
    if (candles.length < this.config.sequenceLength + 1) {
      throw new Error(`Need at least ${this.config.sequenceLength + 1} candles`);
    }
    
    const features: number[][] = [];
    const recentCandles = candles.slice(-this.config.sequenceLength - 1);
    
    // Calculate normalization values
    const prices = recentCandles.map(c => c.close);
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const priceRange = maxPrice - minPrice || 1;
    
    const volumes = recentCandles.map(c => c.volume);
    const maxVolume = Math.max(...volumes) || 1;
    
    for (let i = 1; i < recentCandles.length; i++) {
      const candle = recentCandles[i];
      const prevCandle = recentCandles[i - 1];
      
      const normalizedClose = (candle.close - minPrice) / priceRange;
      const normalizedOpen = (candle.open - minPrice) / priceRange;
      const normalizedHigh = (candle.high - minPrice) / priceRange;
      const normalizedLow = (candle.low - minPrice) / priceRange;
      const normalizedVolume = candle.volume / maxVolume;
      
      const priceReturn = (candle.close - prevCandle.close) / prevCandle.close;
      const bodyRatio = (candle.close - candle.open) / (candle.high - candle.low || 1);
      const upperShadow = (candle.high - Math.max(candle.open, candle.close)) / (candle.high - candle.low || 1);
      const lowerShadow = (Math.min(candle.open, candle.close) - candle.low) / (candle.high - candle.low || 1);
      const volumeChange = (candle.volume - prevCandle.volume) / (prevCandle.volume || 1);
      
      features.push([
        normalizedClose,
        normalizedOpen,
        normalizedHigh,
        normalizedLow,
        normalizedVolume,
        Math.tanh(priceReturn * 10),
        bodyRatio,
        upperShadow,
        lowerShadow,
        Math.tanh(volumeChange)
      ]);
    }
    
    return features;
  }
  
  /**
   * Make price prediction
   */
  predict(candles: Array<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>): TransformerPrediction {
    const features = this.prepareFeatures(candles);
    const output = this.forward(features);
    
    const currentPrice = candles[candles.length - 1].close;
    const predictedChange = output[0];
    
    const priceChange = predictedChange * 0.05;
    const predictedPrice = currentPrice * (1 + priceChange);
    
    let predictedDirection: 'up' | 'down' | 'neutral';
    if (priceChange > 0.001) {
      predictedDirection = 'up';
    } else if (priceChange < -0.001) {
      predictedDirection = 'down';
    } else {
      predictedDirection = 'neutral';
    }
    
    const confidence = Math.min(1, Math.abs(priceChange) * 20);
    
    const now = new Date();
    const targetTimestamp = new Date(now.getTime() + 60 * 60 * 1000);
    
    return {
      predictedPrice,
      predictedDirection,
      confidence,
      priceChange: priceChange * 100,
      attentionWeights: this.lastAttentionWeights,
      timestamp: now,
      targetTimestamp
    };
  }
  
  /**
   * Train the model
   */
  async train(
    trainingData: Array<{
      features: number[][];
      target: number;
    }>,
    epochs: number = 100,
    onEpochComplete?: (epoch: number, loss: number) => void
  ): Promise<{ finalLoss: number; history: Array<{ loss: number; epoch: number }> }> {
    const lr = this.config.learningRate;
    
    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalLoss = 0;
      
      for (const sample of trainingData) {
        const output = this.forward(sample.features);
        const prediction = output[0];
        
        const error = prediction - sample.target;
        const loss = error * error;
        totalLoss += loss;
        
        // Simplified gradient descent (output layer only)
        for (let i = 0; i < this.outputWeights[0].length; i++) {
          this.outputWeights[0][i] -= lr * error * 0.01;
        }
        this.outputBias[0] -= lr * error;
      }
      
      const avgLoss = totalLoss / trainingData.length;
      this.trainingHistory.push({ epoch, loss: avgLoss });
      
      if (onEpochComplete) {
        onEpochComplete(epoch, avgLoss);
      }
    }
    
    return {
      finalLoss: this.trainingHistory[this.trainingHistory.length - 1].loss,
      history: this.trainingHistory
    };
  }
  
  /**
   * Serialize model
   */
  serialize(): string {
    return JSON.stringify({
      config: this.config,
      inputProjection: this.inputProjection,
      inputBias: this.inputBias,
      positionalEncoding: this.positionalEncoding,
      layers: this.layers,
      outputWeights: this.outputWeights,
      outputBias: this.outputBias,
      trainingHistory: this.trainingHistory
    });
  }
  
  /**
   * Deserialize model
   */
  static deserialize(data: string): TransformerPredictor {
    const parsed = JSON.parse(data);
    const model = new TransformerPredictor(parsed.config);
    model.inputProjection = parsed.inputProjection;
    model.inputBias = parsed.inputBias;
    model.positionalEncoding = parsed.positionalEncoding;
    model.layers = parsed.layers;
    model.outputWeights = parsed.outputWeights;
    model.outputBias = parsed.outputBias;
    model.trainingHistory = parsed.trainingHistory || [];
    return model;
  }
  
  /**
   * Get attention weights for visualization
   */
  getAttentionWeights(): number[][] {
    return this.lastAttentionWeights;
  }
  
  /**
   * Get training history
   */
  getTrainingHistory(): Array<{ loss: number; epoch: number }> {
    return [...this.trainingHistory];
  }
  
  /**
   * Get model configuration
   */
  getConfig(): TransformerConfig {
    return { ...this.config };
  }
}

export default TransformerPredictor;
