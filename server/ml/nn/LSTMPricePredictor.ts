/**
 * LSTM Price Prediction Model
 * 
 * Implements Long Short-Term Memory neural network for price prediction.
 * Pure TypeScript implementation without external ML libraries.
 */

export interface LSTMConfig {
  inputSize: number;          // Number of features per timestep
  hiddenSize: number;         // LSTM hidden state size
  numLayers: number;          // Number of stacked LSTM layers
  outputSize: number;         // Prediction output size
  sequenceLength: number;     // Input sequence length
  learningRate: number;
  dropoutRate: number;
}

export interface PredictionResult {
  predictedPrice: number;
  predictedDirection: 'up' | 'down' | 'neutral';
  confidence: number;
  priceChange: number;        // Predicted percentage change
  timestamp: Date;
  targetTimestamp: Date;
}

interface LSTMWeights {
  // Input gate
  Wi: number[][];
  Ui: number[][];
  bi: number[];
  
  // Forget gate
  Wf: number[][];
  Uf: number[][];
  bf: number[];
  
  // Output gate
  Wo: number[][];
  Uo: number[][];
  bo: number[];
  
  // Cell gate
  Wc: number[][];
  Uc: number[][];
  bc: number[];
}

interface LSTMState {
  h: number[];  // Hidden state
  c: number[];  // Cell state
}

export class LSTMPricePredictor {
  private config: LSTMConfig;
  private layers: LSTMWeights[] = [];
  private outputWeights: number[][] = [];
  private outputBias: number[] = [];
  private trainingHistory: { loss: number; epoch: number }[] = [];
  
  constructor(config: Partial<LSTMConfig> = {}) {
    this.config = {
      inputSize: 10,
      hiddenSize: 64,
      numLayers: 2,
      outputSize: 1,
      sequenceLength: 60,
      learningRate: 0.001,
      dropoutRate: 0.2,
      ...config
    };
    
    this.initializeWeights();
  }
  
  /**
   * Initialize LSTM weights with Xavier initialization
   */
  private initializeWeights(): void {
    for (let layer = 0; layer < this.config.numLayers; layer++) {
      const inputSize = layer === 0 ? this.config.inputSize : this.config.hiddenSize;
      const hiddenSize = this.config.hiddenSize;
      
      const scale = Math.sqrt(2.0 / (inputSize + hiddenSize));
      
      this.layers.push({
        Wi: this.randomMatrix(hiddenSize, inputSize, scale),
        Ui: this.randomMatrix(hiddenSize, hiddenSize, scale),
        bi: new Array(hiddenSize).fill(0),
        
        Wf: this.randomMatrix(hiddenSize, inputSize, scale),
        Uf: this.randomMatrix(hiddenSize, hiddenSize, scale),
        bf: new Array(hiddenSize).fill(1), // Initialize forget bias to 1
        
        Wo: this.randomMatrix(hiddenSize, inputSize, scale),
        Uo: this.randomMatrix(hiddenSize, hiddenSize, scale),
        bo: new Array(hiddenSize).fill(0),
        
        Wc: this.randomMatrix(hiddenSize, inputSize, scale),
        Uc: this.randomMatrix(hiddenSize, hiddenSize, scale),
        bc: new Array(hiddenSize).fill(0)
      });
    }
    
    // Output layer
    const outputScale = Math.sqrt(2.0 / (this.config.hiddenSize + this.config.outputSize));
    this.outputWeights = this.randomMatrix(this.config.outputSize, this.config.hiddenSize, outputScale);
    this.outputBias = new Array(this.config.outputSize).fill(0);
  }
  
  /**
   * Create random matrix with given scale
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
   * Sigmoid activation
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
  }
  
  /**
   * Tanh activation
   */
  private tanh(x: number): number {
    return Math.tanh(x);
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
   * Element-wise vector operations
   */
  private vecAdd(a: number[], b: number[]): number[] {
    return a.map((val, i) => val + (b[i] || 0));
  }
  
  private vecMul(a: number[], b: number[]): number[] {
    return a.map((val, i) => val * (b[i] || 0));
  }
  
  /**
   * LSTM cell forward pass
   */
  private lstmCell(
    x: number[],
    prevState: LSTMState,
    weights: LSTMWeights
  ): LSTMState {
    const { h: prevH, c: prevC } = prevState;
    
    // Input gate
    const i = this.vecAdd(
      this.vecAdd(this.matVec(weights.Wi, x), this.matVec(weights.Ui, prevH)),
      weights.bi
    ).map(v => this.sigmoid(v));
    
    // Forget gate
    const f = this.vecAdd(
      this.vecAdd(this.matVec(weights.Wf, x), this.matVec(weights.Uf, prevH)),
      weights.bf
    ).map(v => this.sigmoid(v));
    
    // Output gate
    const o = this.vecAdd(
      this.vecAdd(this.matVec(weights.Wo, x), this.matVec(weights.Uo, prevH)),
      weights.bo
    ).map(v => this.sigmoid(v));
    
    // Cell candidate
    const cCandidate = this.vecAdd(
      this.vecAdd(this.matVec(weights.Wc, x), this.matVec(weights.Uc, prevH)),
      weights.bc
    ).map(v => this.tanh(v));
    
    // New cell state
    const c = this.vecAdd(
      this.vecMul(f, prevC),
      this.vecMul(i, cCandidate)
    );
    
    // New hidden state
    const h = this.vecMul(o, c.map(v => this.tanh(v)));
    
    return { h, c };
  }
  
  /**
   * Forward pass through all LSTM layers
   */
  private forward(sequence: number[][]): number[] {
    let layerInput = sequence;
    
    for (let layer = 0; layer < this.config.numLayers; layer++) {
      const weights = this.layers[layer];
      let state: LSTMState = {
        h: new Array(this.config.hiddenSize).fill(0),
        c: new Array(this.config.hiddenSize).fill(0)
      };
      
      const layerOutput: number[][] = [];
      
      for (const x of layerInput) {
        state = this.lstmCell(x, state, weights);
        layerOutput.push(state.h);
      }
      
      layerInput = layerOutput;
    }
    
    // Get last hidden state
    const lastHidden = layerInput[layerInput.length - 1];
    
    // Output layer
    const output = this.vecAdd(
      this.matVec(this.outputWeights, lastHidden),
      this.outputBias
    );
    
    return output;
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
      
      // Normalized features
      const normalizedClose = (candle.close - minPrice) / priceRange;
      const normalizedOpen = (candle.open - minPrice) / priceRange;
      const normalizedHigh = (candle.high - minPrice) / priceRange;
      const normalizedLow = (candle.low - minPrice) / priceRange;
      const normalizedVolume = candle.volume / maxVolume;
      
      // Price return
      const priceReturn = (candle.close - prevCandle.close) / prevCandle.close;
      
      // Candle body ratio
      const bodyRatio = (candle.close - candle.open) / (candle.high - candle.low || 1);
      
      // Upper/lower shadow ratios
      const upperShadow = (candle.high - Math.max(candle.open, candle.close)) / (candle.high - candle.low || 1);
      const lowerShadow = (Math.min(candle.open, candle.close) - candle.low) / (candle.high - candle.low || 1);
      
      // Volume change
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
    timestamp?: number;
  }>): PredictionResult {
    const features = this.prepareFeatures(candles);
    const output = this.forward(features);
    
    const currentPrice = candles[candles.length - 1].close;
    const predictedChange = output[0]; // Normalized prediction
    
    // Convert to actual price change (assuming output is scaled)
    const priceChange = predictedChange * 0.05; // Max 5% change prediction
    const predictedPrice = currentPrice * (1 + priceChange);
    
    // Determine direction
    let predictedDirection: 'up' | 'down' | 'neutral';
    if (priceChange > 0.001) {
      predictedDirection = 'up';
    } else if (priceChange < -0.001) {
      predictedDirection = 'down';
    } else {
      predictedDirection = 'neutral';
    }
    
    // Calculate confidence based on prediction magnitude
    const confidence = Math.min(1, Math.abs(priceChange) * 20);
    
    const now = new Date();
    const targetTimestamp = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour ahead
    
    return {
      predictedPrice,
      predictedDirection,
      confidence,
      priceChange: priceChange * 100,
      timestamp: now,
      targetTimestamp
    };
  }
  
  /**
   * Train the model on historical data
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
        // Forward pass
        const output = this.forward(sample.features);
        const prediction = output[0];
        
        // Calculate loss (MSE)
        const error = prediction - sample.target;
        const loss = error * error;
        totalLoss += loss;
        
        // Simplified gradient descent (update output layer only for efficiency)
        // In production, full backpropagation through time (BPTT) would be used
        const lastHidden = this.getLastHiddenState(sample.features);
        
        for (let i = 0; i < this.outputWeights[0].length; i++) {
          this.outputWeights[0][i] -= lr * error * lastHidden[i];
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
   * Get last hidden state for gradient computation
   */
  private getLastHiddenState(sequence: number[][]): number[] {
    let layerInput = sequence;
    
    for (let layer = 0; layer < this.config.numLayers; layer++) {
      const weights = this.layers[layer];
      let state: LSTMState = {
        h: new Array(this.config.hiddenSize).fill(0),
        c: new Array(this.config.hiddenSize).fill(0)
      };
      
      const layerOutput: number[][] = [];
      
      for (const x of layerInput) {
        state = this.lstmCell(x, state, weights);
        layerOutput.push(state.h);
      }
      
      layerInput = layerOutput;
    }
    
    return layerInput[layerInput.length - 1];
  }
  
  /**
   * Serialize model for saving
   */
  serialize(): string {
    return JSON.stringify({
      config: this.config,
      layers: this.layers,
      outputWeights: this.outputWeights,
      outputBias: this.outputBias,
      trainingHistory: this.trainingHistory
    });
  }
  
  /**
   * Load model from serialized data
   */
  static deserialize(data: string): LSTMPricePredictor {
    const parsed = JSON.parse(data);
    const model = new LSTMPricePredictor(parsed.config);
    model.layers = parsed.layers;
    model.outputWeights = parsed.outputWeights;
    model.outputBias = parsed.outputBias;
    model.trainingHistory = parsed.trainingHistory || [];
    return model;
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
  getConfig(): LSTMConfig {
    return { ...this.config };
  }
}

export default LSTMPricePredictor;
