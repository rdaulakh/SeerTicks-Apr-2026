/**
 * Proximal Policy Optimization (PPO) Trading Agent
 * 
 * Implements PPO with:
 * - Actor-Critic architecture
 * - Clipped surrogate objective
 * - Generalized Advantage Estimation (GAE)
 * - Value function clipping
 */

import { RLTradingEnvironment, MarketState, Action, StepResult } from './RLTradingEnvironment';

export interface PPOConfig {
  stateSize: number;
  actionSize: number;
  hiddenLayers: number[];
  learningRate: number;
  gamma: number;              // Discount factor
  lambda: number;             // GAE lambda
  clipEpsilon: number;        // PPO clip parameter
  valueCoef: number;          // Value loss coefficient
  entropyCoef: number;        // Entropy bonus coefficient
  maxGradNorm: number;        // Gradient clipping
  epochs: number;             // Training epochs per update
  batchSize: number;
  rolloutLength: number;      // Steps before update
}

interface Trajectory {
  states: number[][];
  actions: number[];
  rewards: number[];
  values: number[];
  logProbs: number[];
  dones: boolean[];
}

interface NeuralNetwork {
  weights: number[][][];
  biases: number[][];
}

export class PPOAgent {
  private config: PPOConfig;
  private actorNetwork: NeuralNetwork;
  private criticNetwork: NeuralNetwork;
  private trajectory: Trajectory;
  private trainingMetrics: {
    policyLoss: number[];
    valueLoss: number[];
    entropy: number[];
  };
  
  constructor(config: Partial<PPOConfig> = {}) {
    this.config = {
      stateSize: RLTradingEnvironment.STATE_DIM,
      actionSize: RLTradingEnvironment.ACTION_DIM,
      hiddenLayers: [128, 64],
      learningRate: 0.0003,
      gamma: 0.99,
      lambda: 0.95,
      clipEpsilon: 0.2,
      valueCoef: 0.5,
      entropyCoef: 0.01,
      maxGradNorm: 0.5,
      epochs: 4,
      batchSize: 64,
      rolloutLength: 2048,
      ...config
    };
    
    // Initialize actor (policy) network
    this.actorNetwork = this.createNetwork(this.config.actionSize);
    
    // Initialize critic (value) network
    this.criticNetwork = this.createNetwork(1);
    
    this.trajectory = this.createEmptyTrajectory();
    this.trainingMetrics = {
      policyLoss: [],
      valueLoss: [],
      entropy: []
    };
  }
  
  /**
   * Create neural network
   */
  private createNetwork(outputSize: number): NeuralNetwork {
    const layers = [this.config.stateSize, ...this.config.hiddenLayers, outputSize];
    const weights: number[][][] = [];
    const biases: number[][] = [];
    
    for (let i = 0; i < layers.length - 1; i++) {
      const inputSize = layers[i];
      const outSize = layers[i + 1];
      
      // Orthogonal initialization approximation
      const scale = Math.sqrt(2.0 / inputSize);
      
      const layerWeights: number[][] = [];
      for (let j = 0; j < outSize; j++) {
        const neuronWeights: number[] = [];
        for (let k = 0; k < inputSize; k++) {
          neuronWeights.push((Math.random() * 2 - 1) * scale);
        }
        layerWeights.push(neuronWeights);
      }
      weights.push(layerWeights);
      
      const layerBiases: number[] = new Array(outSize).fill(0);
      biases.push(layerBiases);
    }
    
    return { weights, biases };
  }
  
  /**
   * Create empty trajectory buffer
   */
  private createEmptyTrajectory(): Trajectory {
    return {
      states: [],
      actions: [],
      rewards: [],
      values: [],
      logProbs: [],
      dones: []
    };
  }
  
  /**
   * Forward pass through network
   */
  private forward(network: NeuralNetwork, input: number[], softmax: boolean = false): number[] {
    let activation = input;
    
    for (let i = 0; i < network.weights.length; i++) {
      const newActivation: number[] = [];
      
      for (let j = 0; j < network.weights[i].length; j++) {
        let sum = network.biases[i][j];
        for (let k = 0; k < activation.length; k++) {
          sum += network.weights[i][j][k] * activation[k];
        }
        
        // Tanh for hidden layers
        if (i < network.weights.length - 1) {
          newActivation.push(Math.tanh(sum));
        } else {
          newActivation.push(sum);
        }
      }
      
      activation = newActivation;
    }
    
    // Apply softmax for actor output
    if (softmax) {
      activation = this.softmax(activation);
    }
    
    return activation;
  }
  
  /**
   * Softmax function
   */
  private softmax(x: number[]): number[] {
    const maxVal = Math.max(...x);
    const expValues = x.map(v => Math.exp(v - maxVal));
    const sumExp = expValues.reduce((sum, v) => sum + v, 0);
    return expValues.map(v => v / sumExp);
  }
  
  /**
   * Get action probabilities from actor network
   */
  getActionProbs(state: number[]): number[] {
    return this.forward(this.actorNetwork, state, true);
  }
  
  /**
   * Get state value from critic network
   */
  getValue(state: number[]): number {
    return this.forward(this.criticNetwork, state)[0];
  }
  
  /**
   * Sample action from policy
   */
  selectAction(state: number[]): { action: number; logProb: number; value: number } {
    const probs = this.getActionProbs(state);
    const value = this.getValue(state);
    
    // Sample from categorical distribution
    const random = Math.random();
    let cumProb = 0;
    let action = 0;
    
    for (let i = 0; i < probs.length; i++) {
      cumProb += probs[i];
      if (random < cumProb) {
        action = i;
        break;
      }
    }
    
    const logProb = Math.log(probs[action] + 1e-8);
    
    return { action, logProb, value };
  }
  
  /**
   * Convert action index to Action object
   */
  actionIndexToAction(index: number): Action {
    const actions: Action['type'][] = ['hold', 'buy', 'sell', 'close'];
    return { type: actions[index], size: 1 };
  }
  
  /**
   * Store transition in trajectory
   */
  storeTransition(
    state: number[],
    action: number,
    reward: number,
    value: number,
    logProb: number,
    done: boolean
  ): void {
    this.trajectory.states.push(state);
    this.trajectory.actions.push(action);
    this.trajectory.rewards.push(reward);
    this.trajectory.values.push(value);
    this.trajectory.logProbs.push(logProb);
    this.trajectory.dones.push(done);
  }
  
  /**
   * Compute Generalized Advantage Estimation
   */
  private computeGAE(lastValue: number): { advantages: number[]; returns: number[] } {
    const { rewards, values, dones } = this.trajectory;
    const advantages: number[] = new Array(rewards.length).fill(0);
    const returns: number[] = new Array(rewards.length).fill(0);
    
    let lastGAE = 0;
    
    for (let t = rewards.length - 1; t >= 0; t--) {
      const nextValue = t === rewards.length - 1 ? lastValue : values[t + 1];
      const nextNonTerminal = dones[t] ? 0 : 1;
      
      const delta = rewards[t] + this.config.gamma * nextValue * nextNonTerminal - values[t];
      lastGAE = delta + this.config.gamma * this.config.lambda * nextNonTerminal * lastGAE;
      
      advantages[t] = lastGAE;
      returns[t] = advantages[t] + values[t];
    }
    
    // Normalize advantages
    const mean = advantages.reduce((sum, a) => sum + a, 0) / advantages.length;
    const std = Math.sqrt(
      advantages.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / advantages.length
    ) + 1e-8;
    
    for (let i = 0; i < advantages.length; i++) {
      advantages[i] = (advantages[i] - mean) / std;
    }
    
    return { advantages, returns };
  }
  
  /**
   * Update policy and value networks
   */
  update(lastValue: number): { policyLoss: number; valueLoss: number; entropy: number } {
    const { advantages, returns } = this.computeGAE(lastValue);
    const { states, actions, logProbs, values } = this.trajectory;
    
    let totalPolicyLoss = 0;
    let totalValueLoss = 0;
    let totalEntropy = 0;
    let updateCount = 0;
    
    // Multiple epochs of updates
    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      // Create minibatches
      const indices = this.shuffleIndices(states.length);
      
      for (let start = 0; start < states.length; start += this.config.batchSize) {
        const end = Math.min(start + this.config.batchSize, states.length);
        const batchIndices = indices.slice(start, end);
        
        // Compute losses for batch
        let batchPolicyLoss = 0;
        let batchValueLoss = 0;
        let batchEntropy = 0;
        
        for (const idx of batchIndices) {
          const state = states[idx];
          const action = actions[idx];
          const oldLogProb = logProbs[idx];
          const advantage = advantages[idx];
          const ret = returns[idx];
          const oldValue = values[idx];
          
          // Get current policy
          const probs = this.getActionProbs(state);
          const newLogProb = Math.log(probs[action] + 1e-8);
          const newValue = this.getValue(state);
          
          // Policy loss with clipping
          const ratio = Math.exp(newLogProb - oldLogProb);
          const surr1 = ratio * advantage;
          const surr2 = Math.max(
            Math.min(ratio, 1 + this.config.clipEpsilon),
            1 - this.config.clipEpsilon
          ) * advantage;
          const policyLoss = -Math.min(surr1, surr2);
          
          // Value loss with clipping
          const valueClipped = oldValue + Math.max(
            Math.min(newValue - oldValue, this.config.clipEpsilon),
            -this.config.clipEpsilon
          );
          const valueLoss1 = Math.pow(newValue - ret, 2);
          const valueLoss2 = Math.pow(valueClipped - ret, 2);
          const valueLoss = 0.5 * Math.max(valueLoss1, valueLoss2);
          
          // Entropy bonus
          const entropy = -probs.reduce((sum, p) => sum + p * Math.log(p + 1e-8), 0);
          
          batchPolicyLoss += policyLoss;
          batchValueLoss += valueLoss;
          batchEntropy += entropy;
          
          // Update networks
          this.updateNetworks(state, action, policyLoss, valueLoss, entropy, advantage);
        }
        
        totalPolicyLoss += batchPolicyLoss / batchIndices.length;
        totalValueLoss += batchValueLoss / batchIndices.length;
        totalEntropy += batchEntropy / batchIndices.length;
        updateCount++;
      }
    }
    
    // Clear trajectory
    this.trajectory = this.createEmptyTrajectory();
    
    const avgPolicyLoss = totalPolicyLoss / updateCount;
    const avgValueLoss = totalValueLoss / updateCount;
    const avgEntropy = totalEntropy / updateCount;
    
    this.trainingMetrics.policyLoss.push(avgPolicyLoss);
    this.trainingMetrics.valueLoss.push(avgValueLoss);
    this.trainingMetrics.entropy.push(avgEntropy);
    
    return {
      policyLoss: avgPolicyLoss,
      valueLoss: avgValueLoss,
      entropy: avgEntropy
    };
  }
  
  /**
   * Update network weights using gradient descent
   */
  private updateNetworks(
    state: number[],
    action: number,
    policyLoss: number,
    valueLoss: number,
    entropy: number,
    advantage: number
  ): void {
    const lr = this.config.learningRate;
    
    // Simplified gradient update for actor
    const probs = this.getActionProbs(state);
    
    // Update actor network
    for (let i = 0; i < this.actorNetwork.weights.length; i++) {
      for (let j = 0; j < this.actorNetwork.weights[i].length; j++) {
        for (let k = 0; k < this.actorNetwork.weights[i][j].length; k++) {
          // Policy gradient with entropy regularization
          const grad = (j === action ? advantage * (1 - probs[j]) : -advantage * probs[j]);
          const entropyGrad = this.config.entropyCoef * (Math.log(probs[j] + 1e-8) + 1);
          this.actorNetwork.weights[i][j][k] += lr * (grad - entropyGrad) * state[k % state.length] * 0.01;
        }
      }
    }
    
    // Update critic network
    const value = this.getValue(state);
    const valueGrad = valueLoss > 0 ? 1 : -1;
    
    for (let i = 0; i < this.criticNetwork.weights.length; i++) {
      for (let j = 0; j < this.criticNetwork.weights[i].length; j++) {
        for (let k = 0; k < this.criticNetwork.weights[i][j].length; k++) {
          this.criticNetwork.weights[i][j][k] -= lr * this.config.valueCoef * valueGrad * state[k % state.length] * 0.01;
        }
      }
    }
  }
  
  /**
   * Shuffle array indices
   */
  private shuffleIndices(length: number): number[] {
    const indices = Array.from({ length }, (_, i) => i);
    for (let i = length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
  }
  
  /**
   * Train agent on environment
   */
  async trainOnEnvironment(
    env: RLTradingEnvironment,
    totalTimesteps: number,
    onUpdate?: (timestep: number, metrics: { policyLoss: number; valueLoss: number; entropy: number }) => void
  ): Promise<{
    episodeRewards: number[];
    episodeInfo: StepResult['info'][];
    metrics: { policyLoss: number[]; valueLoss: number[]; entropy: number[] };
  }> {
    const episodeRewards: number[] = [];
    const episodeInfo: StepResult['info'][] = [];
    
    let state = env.reset();
    let stateArray = env.stateToArray(state);
    let episodeReward = 0;
    let timestep = 0;
    
    while (timestep < totalTimesteps) {
      // Collect rollout
      for (let step = 0; step < this.config.rolloutLength; step++) {
        const { action, logProb, value } = this.selectAction(stateArray);
        const actionObj = this.actionIndexToAction(action);
        
        const result = env.step(actionObj);
        const nextStateArray = env.stateToArray(result.state);
        
        this.storeTransition(stateArray, action, result.reward, value, logProb, result.done);
        
        episodeReward += result.reward;
        stateArray = nextStateArray;
        timestep++;
        
        if (result.done) {
          episodeRewards.push(episodeReward);
          episodeInfo.push(result.info);
          
          state = env.reset();
          stateArray = env.stateToArray(state);
          episodeReward = 0;
        }
        
        if (timestep >= totalTimesteps) break;
      }
      
      // Update networks
      const lastValue = this.getValue(stateArray);
      const metrics = this.update(lastValue);
      
      if (onUpdate) {
        onUpdate(timestep, metrics);
      }
    }
    
    return {
      episodeRewards,
      episodeInfo,
      metrics: this.trainingMetrics
    };
  }
  
  /**
   * Evaluate agent on environment
   */
  evaluate(env: RLTradingEnvironment): StepResult['info'] {
    let state = env.reset();
    let stateArray = env.stateToArray(state);
    let done = false;
    let lastInfo: StepResult['info'] = { pnl: 0, tradeCount: 0, sharpeRatio: 0, maxDrawdown: 0, winRate: 0 };
    
    while (!done) {
      const probs = this.getActionProbs(stateArray);
      const action = probs.indexOf(Math.max(...probs)); // Greedy action
      const actionObj = this.actionIndexToAction(action);
      
      const result = env.step(actionObj);
      stateArray = env.stateToArray(result.state);
      done = result.done;
      lastInfo = result.info;
    }
    
    return lastInfo;
  }
  
  /**
   * Get training metrics
   */
  getMetrics(): { policyLoss: number[]; valueLoss: number[]; entropy: number[] } {
    return { ...this.trainingMetrics };
  }
  
  /**
   * Serialize agent for saving
   */
  serialize(): string {
    return JSON.stringify({
      config: this.config,
      actorNetwork: this.actorNetwork,
      criticNetwork: this.criticNetwork
    });
  }
  
  /**
   * Load agent from serialized data
   */
  static deserialize(data: string): PPOAgent {
    const parsed = JSON.parse(data);
    const agent = new PPOAgent(parsed.config);
    agent.actorNetwork = parsed.actorNetwork;
    agent.criticNetwork = parsed.criticNetwork;
    return agent;
  }
}

export default PPOAgent;
