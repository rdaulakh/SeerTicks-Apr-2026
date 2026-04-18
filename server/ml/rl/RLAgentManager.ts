/**
 * RL Agent Manager
 * 
 * Coordinates multiple RL trading agents:
 * - Training and evaluation
 * - Model persistence
 * - Performance tracking
 * - Paper trading validation
 */

import { RLTradingEnvironment, Candle, StepResult } from './RLTradingEnvironment';
import { DQNAgent } from './DQNAgent';
import { PPOAgent } from './PPOAgent';
import { getDb } from '../../db';
import { sql } from 'drizzle-orm';

export interface RLModelConfig {
  id?: number;
  name: string;
  agentType: 'dqn' | 'ppo';
  symbol: string;
  timeframe: string;
  config: Record<string, any>;
  status: 'training' | 'ready' | 'paper_trading' | 'live' | 'disabled';
}

export interface TrainingSession {
  modelId: number;
  startTime: Date;
  endTime?: Date;
  episodes: number;
  totalTimesteps: number;
  finalMetrics: {
    pnl: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    tradeCount: number;
  };
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

export interface ModelPerformance {
  modelId: number;
  modelName: string;
  agentType: string;
  symbol: string;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalPnL: number;
  tradeCount: number;
  lastUpdated: Date;
}

interface RLModelRow {
  id: number;
  name: string;
  agentType: string;
  symbol: string;
  timeframe: string;
  config: string | null;
  modelData: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

interface RLTrainingRow {
  id: number;
  modelId: number;
  startTime: Date;
  endTime: Date | null;
  episodes: number;
  totalTimesteps: number;
  finalPnl: string | null;
  finalSharpe: string | null;
  finalMaxDrawdown: string | null;
  finalWinRate: string | null;
  tradeCount: number | null;
  status: string;
  error: string | null;
}

export class RLAgentManager {
  private static instance: RLAgentManager;
  private agents: Map<number, DQNAgent | PPOAgent> = new Map();
  private environments: Map<number, RLTradingEnvironment> = new Map();
  private trainingSessions: Map<number, TrainingSession> = new Map();
  
  private constructor() {}
  
  static getInstance(): RLAgentManager {
    if (!RLAgentManager.instance) {
      RLAgentManager.instance = new RLAgentManager();
    }
    return RLAgentManager.instance;
  }
  
  /**
   * Create a new RL model
   */
  async createModel(config: RLModelConfig): Promise<number> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    
    const result = await db.execute(sql`
      INSERT INTO rlModels (name, agentType, symbol, timeframe, config, status)
      VALUES (${config.name}, ${config.agentType}, ${config.symbol}, ${config.timeframe}, 
              ${JSON.stringify(config.config)}, 'training')
    `);
    
    const modelId = Number((result as any)[0].insertId);
    
    // Initialize agent
    if (config.agentType === 'dqn') {
      this.agents.set(modelId, new DQNAgent(config.config));
    } else {
      this.agents.set(modelId, new PPOAgent(config.config));
    }
    
    // Initialize environment
    this.environments.set(modelId, new RLTradingEnvironment(config.config));
    
    console.log(`[RLAgentManager] Created model ${config.name} (ID: ${modelId})`);
    return modelId;
  }
  
  /**
   * Load historical candle data for training
   */
  async loadTrainingData(modelId: number, candles: Candle[]): Promise<void> {
    const env = this.environments.get(modelId);
    if (!env) throw new Error(`Environment not found for model ${modelId}`);
    
    env.loadData(candles);
    console.log(`[RLAgentManager] Loaded ${candles.length} candles for model ${modelId}`);
  }
  
  /**
   * Train a DQN agent
   */
  async trainDQN(
    modelId: number,
    episodes: number,
    onProgress?: (episode: number, info: StepResult['info']) => void
  ): Promise<TrainingSession> {
    const agent = this.agents.get(modelId);
    const env = this.environments.get(modelId);
    
    if (!agent || !(agent instanceof DQNAgent)) {
      throw new Error(`DQN agent not found for model ${modelId}`);
    }
    if (!env) throw new Error(`Environment not found for model ${modelId}`);
    
    const session: TrainingSession = {
      modelId,
      startTime: new Date(),
      episodes,
      totalTimesteps: 0,
      finalMetrics: { pnl: 0, sharpeRatio: 0, maxDrawdown: 0, winRate: 0, tradeCount: 0 },
      status: 'running'
    };
    
    this.trainingSessions.set(modelId, session);
    
    try {
      const result = await agent.trainOnEnvironment(env, episodes, (episode, info) => {
        session.totalTimesteps = episode;
        if (onProgress) onProgress(episode, info);
      });
      
      // Get final evaluation
      const evalResult = agent.evaluate(env);
      
      session.endTime = new Date();
      session.status = 'completed';
      session.finalMetrics = evalResult;
      
      // Save model and training history
      await this.saveModel(modelId);
      await this.saveTrainingHistory(session);
      
      // Update model status
      await this.updateModelStatus(modelId, 'ready');
      
      console.log(`[RLAgentManager] DQN training completed for model ${modelId}`);
      console.log(`  Sharpe: ${evalResult.sharpeRatio.toFixed(2)}, Win Rate: ${(evalResult.winRate * 100).toFixed(1)}%`);
      
      return session;
    } catch (error) {
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : 'Unknown error';
      await this.saveTrainingHistory(session);
      throw error;
    }
  }
  
  /**
   * Train a PPO agent
   */
  async trainPPO(
    modelId: number,
    totalTimesteps: number,
    onProgress?: (timestep: number, metrics: { policyLoss: number; valueLoss: number; entropy: number }) => void
  ): Promise<TrainingSession> {
    const agent = this.agents.get(modelId);
    const env = this.environments.get(modelId);
    
    if (!agent || !(agent instanceof PPOAgent)) {
      throw new Error(`PPO agent not found for model ${modelId}`);
    }
    if (!env) throw new Error(`Environment not found for model ${modelId}`);
    
    const session: TrainingSession = {
      modelId,
      startTime: new Date(),
      episodes: 0,
      totalTimesteps,
      finalMetrics: { pnl: 0, sharpeRatio: 0, maxDrawdown: 0, winRate: 0, tradeCount: 0 },
      status: 'running'
    };
    
    this.trainingSessions.set(modelId, session);
    
    try {
      const result = await agent.trainOnEnvironment(env, totalTimesteps, (timestep, metrics) => {
        if (onProgress) onProgress(timestep, metrics);
      });
      
      session.episodes = result.episodeRewards.length;
      
      // Get final evaluation
      const evalResult = agent.evaluate(env);
      
      session.endTime = new Date();
      session.status = 'completed';
      session.finalMetrics = evalResult;
      
      // Save model and training history
      await this.saveModel(modelId);
      await this.saveTrainingHistory(session);
      
      // Update model status
      await this.updateModelStatus(modelId, 'ready');
      
      console.log(`[RLAgentManager] PPO training completed for model ${modelId}`);
      console.log(`  Sharpe: ${evalResult.sharpeRatio.toFixed(2)}, Win Rate: ${(evalResult.winRate * 100).toFixed(1)}%`);
      
      return session;
    } catch (error) {
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : 'Unknown error';
      await this.saveTrainingHistory(session);
      throw error;
    }
  }
  
  /**
   * Get trading signal from RL agent
   */
  async getSignal(
    modelId: number,
    currentState: number[]
  ): Promise<{ action: string; confidence: number; qValues?: number[] }> {
    const agent = this.agents.get(modelId);
    if (!agent) throw new Error(`Agent not found for model ${modelId}`);
    
    const actions = ['hold', 'buy', 'sell', 'close'];
    
    if (agent instanceof DQNAgent) {
      const qValues = agent.getQValues(currentState);
      const actionIndex = qValues.indexOf(Math.max(...qValues));
      
      // Calculate confidence from Q-value distribution
      const maxQ = Math.max(...qValues);
      const minQ = Math.min(...qValues);
      const confidence = maxQ > minQ ? (maxQ - minQ) / Math.abs(maxQ) : 0;
      
      return {
        action: actions[actionIndex],
        confidence: Math.min(1, Math.max(0, confidence)),
        qValues
      };
    } else if (agent instanceof PPOAgent) {
      const probs = agent.getActionProbs(currentState);
      const actionIndex = probs.indexOf(Math.max(...probs));
      
      return {
        action: actions[actionIndex],
        confidence: probs[actionIndex]
      };
    }
    
    return { action: 'hold', confidence: 0 };
  }
  
  /**
   * Evaluate model on test data
   */
  async evaluateModel(modelId: number, testCandles: Candle[]): Promise<StepResult['info']> {
    const agent = this.agents.get(modelId);
    if (!agent) throw new Error(`Agent not found for model ${modelId}`);
    
    // Create test environment
    const testEnv = new RLTradingEnvironment();
    testEnv.loadData(testCandles);
    
    if (agent instanceof DQNAgent) {
      return agent.evaluate(testEnv);
    } else if (agent instanceof PPOAgent) {
      return agent.evaluate(testEnv);
    }
    
    return { pnl: 0, tradeCount: 0, sharpeRatio: 0, maxDrawdown: 0, winRate: 0 };
  }
  
  /**
   * Save model to database
   */
  private async saveModel(modelId: number): Promise<void> {
    const agent = this.agents.get(modelId);
    if (!agent) return;
    
    const db = await getDb();
    if (!db) return;
    
    const serialized = agent.serialize();
    
    await db.execute(sql`
      UPDATE rlModels SET modelData = ${serialized}, updatedAt = NOW()
      WHERE id = ${modelId}
    `);
    
    console.log(`[RLAgentManager] Saved model ${modelId}`);
  }
  
  /**
   * Load model from database
   */
  async loadModel(modelId: number): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');
    
    const result = await db.execute(sql`
      SELECT * FROM rlModels WHERE id = ${modelId} LIMIT 1
    `);
    
    const rows = (result as any)[0] as RLModelRow[];
    if (rows.length === 0) {
      throw new Error(`Model ${modelId} not found`);
    }
    
    const model = rows[0];
    
    if (!model.modelData) {
      throw new Error(`Model ${modelId} has no saved data`);
    }
    
    if (model.agentType === 'dqn') {
      this.agents.set(modelId, DQNAgent.deserialize(model.modelData));
    } else {
      this.agents.set(modelId, PPOAgent.deserialize(model.modelData));
    }
    
    // Initialize environment
    const config = model.config ? JSON.parse(model.config) : {};
    this.environments.set(modelId, new RLTradingEnvironment(config));
    
    console.log(`[RLAgentManager] Loaded model ${modelId} (${model.name})`);
  }
  
  /**
   * Save training history
   */
  private async saveTrainingHistory(session: TrainingSession): Promise<void> {
    const db = await getDb();
    if (!db) return;
    
    await db.execute(sql`
      INSERT INTO rlTrainingHistory 
      (modelId, startTime, endTime, episodes, totalTimesteps, finalPnl, finalSharpe, 
       finalMaxDrawdown, finalWinRate, tradeCount, status, error)
      VALUES (
        ${session.modelId}, ${session.startTime}, ${session.endTime ?? new Date()},
        ${session.episodes}, ${session.totalTimesteps}, ${session.finalMetrics.pnl},
        ${session.finalMetrics.sharpeRatio}, ${session.finalMetrics.maxDrawdown},
        ${session.finalMetrics.winRate}, ${session.finalMetrics.tradeCount},
        ${session.status}, ${session.error ?? null}
      )
    `);
  }
  
  /**
   * Update model status
   */
  private async updateModelStatus(modelId: number, status: RLModelConfig['status']): Promise<void> {
    const db = await getDb();
    if (!db) return;
    
    await db.execute(sql`
      UPDATE rlModels SET status = ${status}, updatedAt = NOW()
      WHERE id = ${modelId}
    `);
  }
  
  /**
   * Get all models
   */
  async getAllModels(): Promise<RLModelConfig[]> {
    const db = await getDb();
    if (!db) return [];
    
    const result = await db.execute(sql`
      SELECT * FROM rlModels ORDER BY updatedAt DESC
    `);
    
    const rows = (result as any)[0] as RLModelRow[];
    
    return rows.map(m => ({
      id: m.id,
      name: m.name,
      agentType: m.agentType as 'dqn' | 'ppo',
      symbol: m.symbol,
      timeframe: m.timeframe,
      config: m.config ? JSON.parse(m.config) : {},
      status: m.status as RLModelConfig['status']
    }));
  }
  
  /**
   * Get model performance summary
   */
  async getModelPerformance(modelId: number): Promise<ModelPerformance | null> {
    const db = await getDb();
    if (!db) return null;
    
    const modelResult = await db.execute(sql`
      SELECT * FROM rlModels WHERE id = ${modelId} LIMIT 1
    `);
    
    const modelRows = (modelResult as any)[0] as RLModelRow[];
    if (modelRows.length === 0) return null;
    
    const model = modelRows[0];
    
    // Get latest training history
    const historyResult = await db.execute(sql`
      SELECT * FROM rlTrainingHistory 
      WHERE modelId = ${modelId} 
      ORDER BY endTime DESC LIMIT 1
    `);
    
    const historyRows = (historyResult as any)[0] as RLTrainingRow[];
    
    if (historyRows.length === 0) {
      return {
        modelId,
        modelName: model.name,
        agentType: model.agentType,
        symbol: model.symbol,
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        totalPnL: 0,
        tradeCount: 0,
        lastUpdated: model.updatedAt
      };
    }
    
    const history = historyRows[0];
    
    return {
      modelId,
      modelName: model.name,
      agentType: model.agentType,
      symbol: model.symbol,
      sharpeRatio: Number(history.finalSharpe) || 0,
      maxDrawdown: Number(history.finalMaxDrawdown) || 0,
      winRate: Number(history.finalWinRate) || 0,
      totalPnL: Number(history.finalPnl) || 0,
      tradeCount: history.tradeCount || 0,
      lastUpdated: history.endTime ?? model.updatedAt
    };
  }
  
  /**
   * Get training session status
   */
  getTrainingStatus(modelId: number): TrainingSession | null {
    return this.trainingSessions.get(modelId) ?? null;
  }
  
  /**
   * Delete model
   */
  async deleteModel(modelId: number): Promise<void> {
    const db = await getDb();
    if (!db) return;
    
    await db.execute(sql`DELETE FROM rlModels WHERE id = ${modelId}`);
    
    this.agents.delete(modelId);
    this.environments.delete(modelId);
    this.trainingSessions.delete(modelId);
    
    console.log(`[RLAgentManager] Deleted model ${modelId}`);
  }
}

export function getRLAgentManager(): RLAgentManager {
  return RLAgentManager.getInstance();
}

export default RLAgentManager;
