/**
 * Advanced AI/ML Tests
 * 
 * Tests for:
 * - Reinforcement Learning agents (DQN, PPO)
 * - Neural network predictors (LSTM, Transformer, Ensemble)
 * - Bayesian optimization
 * - Self-optimizing parameter tuner
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DQNAgent } from '../ml/rl/DQNAgent';
import { PPOAgent } from '../ml/rl/PPOAgent';
import { RLTradingEnvironment } from '../ml/rl/RLTradingEnvironment';
import { LSTMPricePredictor } from '../ml/nn/LSTMPricePredictor';
import { TransformerPredictor } from '../ml/nn/TransformerPredictor';
import { EnsemblePredictor } from '../ml/nn/EnsemblePredictor';
import { BayesianOptimizer } from '../ml/optimization/BayesianOptimizer';

// Generate mock candle data
function generateMockCandles(count: number): Array<{
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}> {
  const candles = [];
  let price = 50000;
  const startTime = Date.now() - count * 60000;
  
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 500;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * 100;
    const low = Math.min(open, close) - Math.random() * 100;
    const volume = 1000000 + Math.random() * 500000;
    
    candles.push({
      timestamp: startTime + i * 60000,
      open,
      high,
      low,
      close,
      volume
    });
    
    price = close;
  }
  
  return candles;
}

describe('DQN Agent', () => {
  let agent: DQNAgent;
  // Use default state size from RLTradingEnvironment
  const stateSize = 25; // RLTradingEnvironment.STATE_DIM
  const actionSize = 4; // RLTradingEnvironment.ACTION_DIM
  
  beforeEach(() => {
    agent = new DQNAgent({
      stateSize: stateSize,
      actionSize: actionSize,
      hiddenLayers: [64, 32],
      learningRate: 0.001,
      gamma: 0.99,
      epsilon: 0.5, // Lower epsilon for more deterministic tests
      epsilonDecay: 0.995,
      epsilonMin: 0.01,
      batchSize: 32,
      replayBufferSize: 1000
    });
  });
  
  it('should initialize correctly', () => {
    // Agent should be created without errors
    expect(agent).toBeDefined();
  });
  
  it('should select actions within valid range', () => {
    const state = Array(stateSize).fill(0).map(() => Math.random());
    const action = agent.selectAction(state, false); // No exploration
    expect(action).toBeGreaterThanOrEqual(0);
    expect(action).toBeLessThan(actionSize);
  });
  
  it('should compute Q-values for all actions', () => {
    const state = Array(stateSize).fill(0).map(() => Math.random());
    const qValues = agent.getQValues(state);
    expect(qValues.length).toBe(actionSize);
    qValues.forEach(q => {
      expect(typeof q).toBe('number');
      expect(isNaN(q)).toBe(false);
    });
  });
  
  it('should store experiences', () => {
    const state = Array(stateSize).fill(0).map(() => Math.random());
    const nextState = Array(stateSize).fill(0).map(() => Math.random());
    
    // Store experience
    agent.remember(state, 1, 0.5, nextState, false);
    
    // Agent should accept experiences without error
    expect(agent).toBeDefined();
  });
  
  it('should serialize and deserialize correctly', () => {
    const state = Array(stateSize).fill(0).map(() => Math.random());
    agent.selectAction(state, false);
    
    const serialized = agent.serialize();
    expect(serialized).toBeDefined();
    expect(typeof serialized).toBe('string');
    
    const restored = DQNAgent.deserialize(serialized);
    expect(restored).toBeDefined();
    
    const originalQ = agent.getQValues(state);
    const restoredQ = restored.getQValues(state);
    
    expect(restoredQ.length).toBe(originalQ.length);
    // Q-values should be approximately equal
    for (let i = 0; i < originalQ.length; i++) {
      expect(Math.abs(originalQ[i] - restoredQ[i])).toBeLessThan(0.001);
    }
  });
});

describe('PPO Agent', () => {
  let agent: PPOAgent;
  const stateSize = 25;
  const actionSize = 4;
  
  beforeEach(() => {
    agent = new PPOAgent({
      stateSize: stateSize,
      actionSize: actionSize,
      hiddenLayers: [64, 32],
      learningRate: 0.0003,
      gamma: 0.99,
      clipEpsilon: 0.2,
      entropyCoef: 0.01,
      valueCoef: 0.5,
      maxGradNorm: 0.5,
      batchSize: 64,
      nEpochs: 4
    });
  });
  
  it('should initialize correctly', () => {
    expect(agent).toBeDefined();
  });
  
  it('should select actions within valid range', () => {
    const state = Array(stateSize).fill(0).map(() => Math.random());
    const result = agent.selectAction(state);
    // PPO returns { action, logProb, value }
    expect(result.action).toBeGreaterThanOrEqual(0);
    expect(result.action).toBeLessThan(actionSize);
    expect(typeof result.logProb).toBe('number');
    expect(typeof result.value).toBe('number');
  });
  
  it('should compute action probabilities that sum to 1', () => {
    const state = Array(stateSize).fill(0).map(() => Math.random());
    const probs = agent.getActionProbs(state);
    
    expect(probs.length).toBe(actionSize);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.01);
  });
  
  it('should serialize and deserialize correctly', () => {
    const state = Array(stateSize).fill(0).map(() => Math.random());
    agent.selectAction(state);
    
    const serialized = agent.serialize();
    expect(serialized).toBeDefined();
    
    const restored = PPOAgent.deserialize(serialized);
    expect(restored).toBeDefined();
    
    const originalProbs = agent.getActionProbs(state);
    const restoredProbs = restored.getActionProbs(state);
    
    expect(restoredProbs.length).toBe(originalProbs.length);
  });
});

describe('RL Trading Environment', () => {
  let env: RLTradingEnvironment;
  const mockCandles = generateMockCandles(200);
  
  beforeEach(() => {
    env = new RLTradingEnvironment({
      initialBalance: 10000,
      maxPositionSize: 1.0,
      transactionCost: 0.001,
      lookbackPeriod: 60
    });
    env.loadData(mockCandles);
  });
  
  it('should initialize with correct state', () => {
    const state = env.reset();
    // State is a MarketState object, not an array
    expect(state).toBeDefined();
    expect(typeof state.equity).toBe('number');
    expect(typeof state.rsi).toBe('number');
  });
  
  it('should execute buy action', () => {
    env.reset();
    // Action is an object with type property
    const result = env.step({ type: 'buy', size: 0.5 });
    
    expect(result.state).toBeDefined();
    expect(typeof result.reward).toBe('number');
    expect(typeof result.done).toBe('boolean');
    expect(result.info).toBeDefined();
  });
  
  it('should execute sell action', () => {
    env.reset();
    env.step({ type: 'buy', size: 0.5 }); // Buy first
    const result = env.step({ type: 'close' }); // Close position
    
    expect(result.state).toBeDefined();
    expect(typeof result.reward).toBe('number');
  });
  
  it('should track P&L correctly', () => {
    env.reset();
    
    // Execute some trades
    const actions: Array<{ type: 'hold' | 'buy' | 'sell' | 'close'; size?: number }> = [
      { type: 'hold' },
      { type: 'buy', size: 0.5 },
      { type: 'hold' },
      { type: 'close' }
    ];
    
    let lastResult;
    for (const action of actions) {
      lastResult = env.step(action);
      if (lastResult.done) break;
    }
    
    // Info is returned in step result
    expect(lastResult).toBeDefined();
    expect(typeof lastResult!.info.pnl).toBe('number');
    expect(typeof lastResult!.info.tradeCount).toBe('number');
  });
});

describe('LSTM Price Predictor', () => {
  let predictor: LSTMPricePredictor;
  const mockCandles = generateMockCandles(100);
  
  beforeEach(() => {
    predictor = new LSTMPricePredictor({
      inputSize: 10,
      hiddenSize: 32,
      numLayers: 1,
      outputSize: 1,
      sequenceLength: 60,
      learningRate: 0.001,
      dropoutRate: 0.1
    });
  });
  
  it('should initialize with correct configuration', () => {
    const config = predictor.getConfig();
    expect(config.inputSize).toBe(10);
    expect(config.hiddenSize).toBe(32);
    expect(config.sequenceLength).toBe(60);
  });
  
  it('should prepare features from candles', () => {
    const features = predictor.prepareFeatures(mockCandles);
    expect(features.length).toBe(60);
    expect(features[0].length).toBe(10);
  });
  
  it('should make predictions', () => {
    const prediction = predictor.predict(mockCandles);
    
    expect(typeof prediction.predictedPrice).toBe('number');
    expect(['up', 'down', 'neutral']).toContain(prediction.predictedDirection);
    expect(prediction.confidence).toBeGreaterThanOrEqual(0);
    expect(prediction.confidence).toBeLessThanOrEqual(1);
  });
  
  it('should serialize and deserialize correctly', () => {
    const serialized = predictor.serialize();
    const restored = LSTMPricePredictor.deserialize(serialized);
    
    const originalPrediction = predictor.predict(mockCandles);
    const restoredPrediction = restored.predict(mockCandles);
    
    expect(restoredPrediction.predictedDirection).toBe(originalPrediction.predictedDirection);
  });
});

describe('Transformer Predictor', () => {
  let predictor: TransformerPredictor;
  const mockCandles = generateMockCandles(100);
  
  beforeEach(() => {
    predictor = new TransformerPredictor({
      inputSize: 10,
      modelDim: 32,
      numHeads: 2,
      numLayers: 1,
      ffnDim: 64,
      sequenceLength: 60,
      outputSize: 1,
      learningRate: 0.001,
      dropoutRate: 0.1
    });
  });
  
  it('should initialize with correct configuration', () => {
    const config = predictor.getConfig();
    expect(config.inputSize).toBe(10);
    expect(config.modelDim).toBe(32);
    expect(config.numHeads).toBe(2);
  });
  
  it('should make predictions with attention weights', () => {
    const prediction = predictor.predict(mockCandles);
    
    expect(typeof prediction.predictedPrice).toBe('number');
    expect(['up', 'down', 'neutral']).toContain(prediction.predictedDirection);
    expect(prediction.attentionWeights.length).toBeGreaterThan(0);
  });
  
  it('should serialize and deserialize correctly', () => {
    const serialized = predictor.serialize();
    const restored = TransformerPredictor.deserialize(serialized);
    
    const originalConfig = predictor.getConfig();
    const restoredConfig = restored.getConfig();
    
    expect(restoredConfig.modelDim).toBe(originalConfig.modelDim);
    expect(restoredConfig.numHeads).toBe(originalConfig.numHeads);
  });
});

describe('Ensemble Predictor', () => {
  let ensemble: EnsemblePredictor;
  const mockCandles = generateMockCandles(100);
  
  beforeEach(() => {
    ensemble = new EnsemblePredictor({
      lstmWeight: 0.5,
      transformerWeight: 0.5,
      confidenceThreshold: 0.6,
      calibrationEnabled: true,
      adaptiveWeights: true
    });
  });
  
  it('should combine LSTM and Transformer predictions', () => {
    const prediction = ensemble.predict(mockCandles);
    
    expect(typeof prediction.predictedPrice).toBe('number');
    expect(['up', 'down', 'neutral']).toContain(prediction.predictedDirection);
    expect(typeof prediction.modelAgreement).toBe('boolean');
    expect(prediction.lstmPrediction).toBeDefined();
    expect(prediction.transformerPrediction).toBeDefined();
  });
  
  it('should track model weights', () => {
    const weights = ensemble.getModelWeights();
    expect(weights.lstm + weights.transformer).toBeCloseTo(1, 1);
  });
  
  it('should serialize and deserialize correctly', () => {
    const serialized = ensemble.serialize();
    const restored = EnsemblePredictor.deserialize(serialized);
    
    const originalWeights = ensemble.getModelWeights();
    const restoredWeights = restored.getModelWeights();
    
    expect(restoredWeights.lstm).toBeCloseTo(originalWeights.lstm, 2);
  });
});

describe('Bayesian Optimizer', () => {
  it('should optimize a simple quadratic function', async () => {
    const optimizer = new BayesianOptimizer(
      [{ name: 'x', type: 'continuous', min: -5, max: 5 }],
      {
        maxIterations: 20,
        randomInitPoints: 5,
        acquisitionFunction: 'ei'
      }
    );
    
    // Optimize f(x) = -(x-2)^2 (maximum at x=2)
    const result = await optimizer.optimize(async (params) => {
      const x = params.x as number;
      return -(x - 2) * (x - 2);
    });
    
    expect(result.bestScore).toBeGreaterThan(-10);
    // Iteration history only includes iterations after random init points
    expect(result.iterationHistory.length).toBeGreaterThanOrEqual(10);
  });
  
  it('should handle multi-dimensional optimization', async () => {
    const optimizer = new BayesianOptimizer(
      [
        { name: 'x', type: 'continuous', min: 0, max: 1 },
        { name: 'y', type: 'continuous', min: 0, max: 1 }
      ],
      {
        maxIterations: 15,
        randomInitPoints: 5,
        acquisitionFunction: 'ucb'
      }
    );
    
    const result = await optimizer.optimize(async (params) => {
      const x = params.x as number;
      const y = params.y as number;
      return -(x - 0.5) * (x - 0.5) - (y - 0.5) * (y - 0.5);
    });
    
    expect(result.bestParameters).toHaveProperty('x');
    expect(result.bestParameters).toHaveProperty('y');
    expect(result.totalIterations).toBe(15);
  });
  
  it('should support integer parameters', async () => {
    const optimizer = new BayesianOptimizer(
      [{ name: 'n', type: 'integer', min: 1, max: 10 }],
      {
        maxIterations: 10,
        randomInitPoints: 3
      }
    );
    
    const result = await optimizer.optimize(async (params) => {
      const n = params.n as number;
      return n === 5 ? 1 : 0;
    });
    
    expect(Number.isInteger(result.bestParameters.n)).toBe(true);
  });
  
  it('should track iteration history', async () => {
    const optimizer = new BayesianOptimizer(
      [{ name: 'x', type: 'continuous', min: 0, max: 1 }],
      { maxIterations: 10, randomInitPoints: 3 }
    );
    
    const result = await optimizer.optimize(async (params) => {
      return Math.random();
    });
    
    expect(result.iterationHistory.length).toBeGreaterThanOrEqual(5);
    result.iterationHistory.forEach(entry => {
      expect(entry).toHaveProperty('iteration');
      expect(entry).toHaveProperty('parameters');
      expect(entry).toHaveProperty('score');
    });
  });
});
