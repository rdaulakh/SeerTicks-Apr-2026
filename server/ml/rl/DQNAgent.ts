/**
 * Deep Q-Network (DQN) Trading Agent
 * 
 * Implements DQN with:
 * - Experience replay buffer
 * - Target network for stable learning
 * - Epsilon-greedy exploration
 * - Double DQN for reduced overestimation
 */

import { RLTradingEnvironment, MarketState, Action, StepResult } from './RLTradingEnvironment';

export interface DQNConfig {
  stateSize: number;
  actionSize: number;
  hiddenLayers: number[];
  learningRate: number;
  gamma: number;              // Discount factor
  epsilon: number;            // Exploration rate
  epsilonMin: number;
  epsilonDecay: number;
  batchSize: number;
  replayBufferSize: number;
  targetUpdateFrequency: number;
  doubleDQN: boolean;
}

interface Experience {
  state: number[];
  action: number;
  reward: number;
  nextState: number[];
  done: boolean;
}

interface NeuralNetwork {
  weights: number[][][];
  biases: number[][];
}

export class DQNAgent {
  private config: DQNConfig;
  private qNetwork: NeuralNetwork;
  private targetNetwork: NeuralNetwork;
  private replayBuffer: Experience[] = [];
  private stepCount: number = 0;
  private trainingLoss: number[] = [];
  
  constructor(config: Partial<DQNConfig> = {}) {
    this.config = {
      stateSize: RLTradingEnvironment.STATE_DIM,
      actionSize: RLTradingEnvironment.ACTION_DIM,
      hiddenLayers: [128, 64, 32],
      learningRate: 0.001,
      gamma: 0.99,
      epsilon: 1.0,
      epsilonMin: 0.01,
      epsilonDecay: 0.995,
      batchSize: 64,
      replayBufferSize: 100000,
      targetUpdateFrequency: 100,
      doubleDQN: true,
      ...config
    };
    
    // Initialize networks
    this.qNetwork = this.createNetwork();
    this.targetNetwork = this.createNetwork();
    this.copyWeights(this.qNetwork, this.targetNetwork);
  }
  
  /**
   * Create neural network with random initialization
   */
  private createNetwork(): NeuralNetwork {
    const layers = [this.config.stateSize, ...this.config.hiddenLayers, this.config.actionSize];
    const weights: number[][][] = [];
    const biases: number[][] = [];
    
    for (let i = 0; i < layers.length - 1; i++) {
      const inputSize = layers[i];
      const outputSize = layers[i + 1];
      
      // Xavier initialization
      const scale = Math.sqrt(2.0 / (inputSize + outputSize));
      
      const layerWeights: number[][] = [];
      for (let j = 0; j < outputSize; j++) {
        const neuronWeights: number[] = [];
        for (let k = 0; k < inputSize; k++) {
          neuronWeights.push((Math.random() * 2 - 1) * scale);
        }
        layerWeights.push(neuronWeights);
      }
      weights.push(layerWeights);
      
      // Initialize biases to small values
      const layerBiases: number[] = [];
      for (let j = 0; j < outputSize; j++) {
        layerBiases.push(0.01);
      }
      biases.push(layerBiases);
    }
    
    return { weights, biases };
  }
  
  /**
   * Copy weights from source to target network
   */
  private copyWeights(source: NeuralNetwork, target: NeuralNetwork): void {
    for (let i = 0; i < source.weights.length; i++) {
      for (let j = 0; j < source.weights[i].length; j++) {
        for (let k = 0; k < source.weights[i][j].length; k++) {
          target.weights[i][j][k] = source.weights[i][j][k];
        }
      }
      for (let j = 0; j < source.biases[i].length; j++) {
        target.biases[i][j] = source.biases[i][j];
      }
    }
  }
  
  /**
   * Forward pass through network
   */
  private forward(network: NeuralNetwork, input: number[]): number[] {
    let activation = input;
    
    for (let i = 0; i < network.weights.length; i++) {
      const newActivation: number[] = [];
      
      for (let j = 0; j < network.weights[i].length; j++) {
        let sum = network.biases[i][j];
        for (let k = 0; k < activation.length; k++) {
          sum += network.weights[i][j][k] * activation[k];
        }
        
        // ReLU for hidden layers, linear for output
        if (i < network.weights.length - 1) {
          newActivation.push(Math.max(0, sum));
        } else {
          newActivation.push(sum);
        }
      }
      
      activation = newActivation;
    }
    
    return activation;
  }
  
  /**
   * Get Q-values for a state
   */
  getQValues(state: number[]): number[] {
    return this.forward(this.qNetwork, state);
  }
  
  /**
   * Select action using epsilon-greedy policy
   */
  selectAction(state: number[], training: boolean = true): number {
    if (training && Math.random() < this.config.epsilon) {
      // Explore: random action
      return Math.floor(Math.random() * this.config.actionSize);
    }
    
    // Exploit: best action
    const qValues = this.getQValues(state);
    return qValues.indexOf(Math.max(...qValues));
  }
  
  /**
   * Convert action index to Action object
   */
  actionIndexToAction(index: number): Action {
    const actions: Action['type'][] = ['hold', 'buy', 'sell', 'close'];
    return { type: actions[index], size: 1 };
  }
  
  /**
   * Store experience in replay buffer
   */
  remember(state: number[], action: number, reward: number, nextState: number[], done: boolean): void {
    this.replayBuffer.push({ state, action, reward, nextState, done });
    
    // Remove oldest experiences if buffer is full
    if (this.replayBuffer.length > this.config.replayBufferSize) {
      this.replayBuffer.shift();
    }
  }
  
  /**
   * Train on a batch of experiences
   */
  train(): number {
    if (this.replayBuffer.length < this.config.batchSize) {
      return 0;
    }
    
    // Sample random batch
    const batch = this.sampleBatch(this.config.batchSize);
    
    let totalLoss = 0;
    
    for (const experience of batch) {
      const { state, action, reward, nextState, done } = experience;
      
      // Calculate target Q-value
      let target = reward;
      
      if (!done) {
        if (this.config.doubleDQN) {
          // Double DQN: use online network to select action, target network to evaluate
          const nextQValues = this.getQValues(nextState);
          const bestAction = nextQValues.indexOf(Math.max(...nextQValues));
          const targetQValues = this.forward(this.targetNetwork, nextState);
          target += this.config.gamma * targetQValues[bestAction];
        } else {
          // Standard DQN
          const targetQValues = this.forward(this.targetNetwork, nextState);
          target += this.config.gamma * Math.max(...targetQValues);
        }
      }
      
      // Get current Q-values
      const currentQValues = this.getQValues(state);
      const error = target - currentQValues[action];
      totalLoss += error * error;
      
      // Backpropagation (simplified gradient descent)
      this.updateWeights(state, action, error);
    }
    
    // Update target network periodically
    this.stepCount++;
    if (this.stepCount % this.config.targetUpdateFrequency === 0) {
      this.copyWeights(this.qNetwork, this.targetNetwork);
    }
    
    // Decay epsilon
    if (this.config.epsilon > this.config.epsilonMin) {
      this.config.epsilon *= this.config.epsilonDecay;
    }
    
    const avgLoss = totalLoss / batch.length;
    this.trainingLoss.push(avgLoss);
    
    return avgLoss;
  }
  
  /**
   * Update network weights using gradient descent
   */
  private updateWeights(state: number[], action: number, error: number): void {
    // Forward pass to get activations
    const activations: number[][] = [state];
    let activation = state;
    
    for (let i = 0; i < this.qNetwork.weights.length; i++) {
      const newActivation: number[] = [];
      
      for (let j = 0; j < this.qNetwork.weights[i].length; j++) {
        let sum = this.qNetwork.biases[i][j];
        for (let k = 0; k < activation.length; k++) {
          sum += this.qNetwork.weights[i][j][k] * activation[k];
        }
        
        if (i < this.qNetwork.weights.length - 1) {
          newActivation.push(Math.max(0, sum));
        } else {
          newActivation.push(sum);
        }
      }
      
      activation = newActivation;
      activations.push(activation);
    }
    
    // Backward pass
    const deltas: number[][] = [];
    
    // Output layer delta
    const outputDelta: number[] = new Array(this.config.actionSize).fill(0);
    outputDelta[action] = error;
    deltas.unshift(outputDelta);
    
    // Hidden layer deltas
    for (let i = this.qNetwork.weights.length - 2; i >= 0; i--) {
      const layerDelta: number[] = [];
      
      for (let j = 0; j < this.qNetwork.weights[i].length; j++) {
        let sum = 0;
        for (let k = 0; k < this.qNetwork.weights[i + 1].length; k++) {
          sum += this.qNetwork.weights[i + 1][k][j] * deltas[0][k];
        }
        // ReLU derivative
        const reluDerivative = activations[i + 1][j] > 0 ? 1 : 0;
        layerDelta.push(sum * reluDerivative);
      }
      
      deltas.unshift(layerDelta);
    }
    
    // Update weights and biases
    for (let i = 0; i < this.qNetwork.weights.length; i++) {
      for (let j = 0; j < this.qNetwork.weights[i].length; j++) {
        for (let k = 0; k < this.qNetwork.weights[i][j].length; k++) {
          this.qNetwork.weights[i][j][k] += this.config.learningRate * deltas[i][j] * activations[i][k];
        }
        this.qNetwork.biases[i][j] += this.config.learningRate * deltas[i][j];
      }
    }
  }
  
  /**
   * Sample random batch from replay buffer
   */
  private sampleBatch(size: number): Experience[] {
    const batch: Experience[] = [];
    const indices = new Set<number>();
    
    while (indices.size < size) {
      indices.add(Math.floor(Math.random() * this.replayBuffer.length));
    }
    
    for (const index of indices) {
      batch.push(this.replayBuffer[index]);
    }
    
    return batch;
  }
  
  /**
   * Train agent on environment for multiple episodes
   */
  async trainOnEnvironment(
    env: RLTradingEnvironment,
    episodes: number,
    onEpisodeComplete?: (episode: number, info: StepResult['info']) => void
  ): Promise<{
    episodeRewards: number[];
    episodeInfo: StepResult['info'][];
    finalEpsilon: number;
    avgLoss: number;
  }> {
    const episodeRewards: number[] = [];
    const episodeInfo: StepResult['info'][] = [];
    
    for (let episode = 0; episode < episodes; episode++) {
      let state = env.reset();
      let stateArray = env.stateToArray(state);
      let totalReward = 0;
      let done = false;
      
      while (!done) {
        // Select action
        const actionIndex = this.selectAction(stateArray);
        const action = this.actionIndexToAction(actionIndex);
        
        // Take step
        const result = env.step(action);
        const nextStateArray = env.stateToArray(result.state);
        
        // Store experience
        this.remember(stateArray, actionIndex, result.reward, nextStateArray, result.done);
        
        // Train
        this.train();
        
        totalReward += result.reward;
        stateArray = nextStateArray;
        done = result.done;
      }
      
      episodeRewards.push(totalReward);
      episodeInfo.push(env.step({ type: 'hold' }).info);
      
      if (onEpisodeComplete) {
        onEpisodeComplete(episode, episodeInfo[episodeInfo.length - 1]);
      }
    }
    
    const avgLoss = this.trainingLoss.length > 0
      ? this.trainingLoss.reduce((sum, l) => sum + l, 0) / this.trainingLoss.length
      : 0;
    
    return {
      episodeRewards,
      episodeInfo,
      finalEpsilon: this.config.epsilon,
      avgLoss
    };
  }
  
  /**
   * Evaluate agent on environment (no training)
   */
  evaluate(env: RLTradingEnvironment): StepResult['info'] {
    let state = env.reset();
    let stateArray = env.stateToArray(state);
    let done = false;
    let lastInfo: StepResult['info'] = { pnl: 0, tradeCount: 0, sharpeRatio: 0, maxDrawdown: 0, winRate: 0 };
    
    while (!done) {
      const actionIndex = this.selectAction(stateArray, false); // No exploration
      const action = this.actionIndexToAction(actionIndex);
      const result = env.step(action);
      
      stateArray = env.stateToArray(result.state);
      done = result.done;
      lastInfo = result.info;
    }
    
    return lastInfo;
  }
  
  /**
   * Get current epsilon value
   */
  getEpsilon(): number {
    return this.config.epsilon;
  }
  
  /**
   * Get training loss history
   */
  getTrainingLoss(): number[] {
    return [...this.trainingLoss];
  }
  
  /**
   * Get replay buffer size
   */
  getBufferSize(): number {
    return this.replayBuffer.length;
  }
  
  /**
   * Serialize agent for saving
   */
  serialize(): string {
    return JSON.stringify({
      config: this.config,
      qNetwork: this.qNetwork,
      targetNetwork: this.targetNetwork,
      epsilon: this.config.epsilon,
      stepCount: this.stepCount
    });
  }
  
  /**
   * Load agent from serialized data
   */
  static deserialize(data: string): DQNAgent {
    const parsed = JSON.parse(data);
    const agent = new DQNAgent(parsed.config);
    agent.qNetwork = parsed.qNetwork;
    agent.targetNetwork = parsed.targetNetwork;
    agent.config.epsilon = parsed.epsilon;
    agent.stepCount = parsed.stepCount;
    return agent;
  }
}

export default DQNAgent;
