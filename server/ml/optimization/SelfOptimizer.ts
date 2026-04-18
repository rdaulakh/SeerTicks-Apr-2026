/**
 * Self-Optimizing Parameter Tuner
 * 
 * Automatically tunes trading strategy parameters, agent weights,
 * and risk parameters using Bayesian optimization.
 */

import { BayesianOptimizer, ParameterSpace, OptimizationResult } from './BayesianOptimizer';
import { getDb } from '../../db';
import { sql } from 'drizzle-orm';

export type OptimizationType = 
  | 'strategy_params'
  | 'agent_weights'
  | 'risk_params'
  | 'ml_hyperparams';

export interface OptimizationTask {
  id?: number;
  type: OptimizationType;
  targetMetric: string;
  symbol?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  result?: OptimizationResult;
  error?: string;
  startTime?: Date;
  endTime?: Date;
}

export interface StrategyParams {
  consensusThreshold: number;
  minConfidence: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  maxDrawdown: number;
}

export interface AgentWeights {
  technicalWeight: number;
  sentimentWeight: number;
  fundamentalWeight: number;
  volumeWeight: number;
  momentumWeight: number;
}

export interface RiskParams {
  maxPositionSize: number;
  maxDailyLoss: number;
  maxDrawdown: number;
  riskPerTrade: number;
  correlationLimit: number;
}

export interface MLHyperparams {
  learningRate: number;
  hiddenSize: number;
  numLayers: number;
  dropoutRate: number;
  batchSize: number;
}

// Parameter space definitions
const STRATEGY_PARAM_SPACE: ParameterSpace[] = [
  { name: 'consensusThreshold', type: 'continuous', min: 0.5, max: 0.9 },
  { name: 'minConfidence', type: 'continuous', min: 0.4, max: 0.8 },
  { name: 'stopLoss', type: 'continuous', min: 0.01, max: 0.1 },
  { name: 'takeProfit', type: 'continuous', min: 0.02, max: 0.2 },
  { name: 'positionSize', type: 'continuous', min: 0.05, max: 0.3 },
  { name: 'maxDrawdown', type: 'continuous', min: 0.1, max: 0.3 }
];

const AGENT_WEIGHT_SPACE: ParameterSpace[] = [
  { name: 'technicalWeight', type: 'continuous', min: 0, max: 1 },
  { name: 'sentimentWeight', type: 'continuous', min: 0, max: 1 },
  { name: 'fundamentalWeight', type: 'continuous', min: 0, max: 1 },
  { name: 'volumeWeight', type: 'continuous', min: 0, max: 1 },
  { name: 'momentumWeight', type: 'continuous', min: 0, max: 1 }
];

const RISK_PARAM_SPACE: ParameterSpace[] = [
  { name: 'maxPositionSize', type: 'continuous', min: 0.05, max: 0.25 },
  { name: 'maxDailyLoss', type: 'continuous', min: 0.02, max: 0.1 },
  { name: 'maxDrawdown', type: 'continuous', min: 0.1, max: 0.3 },
  { name: 'riskPerTrade', type: 'continuous', min: 0.01, max: 0.05 },
  { name: 'correlationLimit', type: 'continuous', min: 0.3, max: 0.8 }
];

const ML_HYPERPARAM_SPACE: ParameterSpace[] = [
  { name: 'learningRate', type: 'continuous', min: 0.0001, max: 0.01 },
  { name: 'hiddenSize', type: 'integer', min: 32, max: 256 },
  { name: 'numLayers', type: 'integer', min: 1, max: 4 },
  { name: 'dropoutRate', type: 'continuous', min: 0, max: 0.5 },
  { name: 'batchSize', type: 'integer', min: 16, max: 128 }
];

export class SelfOptimizer {
  private static instance: SelfOptimizer;
  private activeTasks: Map<number, OptimizationTask> = new Map();
  private taskIdCounter: number = 0;
  
  private constructor() {}
  
  static getInstance(): SelfOptimizer {
    if (!SelfOptimizer.instance) {
      SelfOptimizer.instance = new SelfOptimizer();
    }
    return SelfOptimizer.instance;
  }
  
  /**
   * Start optimization task
   */
  async startOptimization(
    type: OptimizationType,
    targetMetric: string,
    evaluator: (params: Record<string, number | string>) => Promise<number>,
    options: {
      symbol?: string;
      maxIterations?: number;
      onProgress?: (progress: number, params: Record<string, number | string>, score: number) => void;
    } = {}
  ): Promise<OptimizationTask> {
    const taskId = ++this.taskIdCounter;
    
    const task: OptimizationTask = {
      id: taskId,
      type,
      targetMetric,
      symbol: options.symbol,
      status: 'running',
      progress: 0,
      startTime: new Date()
    };
    
    this.activeTasks.set(taskId, task);
    
    // Save to database
    await this.saveTaskToDb(task);
    
    // Get parameter space for optimization type
    const paramSpace = this.getParameterSpace(type);
    
    // Create optimizer
    const optimizer = new BayesianOptimizer(paramSpace, {
      maxIterations: options.maxIterations || 50,
      explorationRate: 0.1,
      acquisitionFunction: 'ei',
      randomInitPoints: 5
    });
    
    try {
      // Run optimization
      const result = await optimizer.optimize(
        evaluator,
        (iteration, params, score) => {
          task.progress = (iteration / (options.maxIterations || 50)) * 100;
          if (options.onProgress) {
            options.onProgress(task.progress, params, score);
          }
        }
      );
      
      task.status = 'completed';
      task.result = result;
      task.endTime = new Date();
      task.progress = 100;
      
      // Save result to database
      await this.saveTaskToDb(task);
      await this.saveOptimizationResult(task, result);
      
      console.log(`[SelfOptimizer] Optimization completed for ${type}`);
      console.log(`  Best score: ${result.bestScore.toFixed(4)}`);
      console.log(`  Best params:`, result.bestParameters);
      
      return task;
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      task.endTime = new Date();
      
      await this.saveTaskToDb(task);
      
      throw error;
    }
  }
  
  /**
   * Get parameter space for optimization type
   */
  private getParameterSpace(type: OptimizationType): ParameterSpace[] {
    switch (type) {
      case 'strategy_params':
        return STRATEGY_PARAM_SPACE;
      case 'agent_weights':
        return AGENT_WEIGHT_SPACE;
      case 'risk_params':
        return RISK_PARAM_SPACE;
      case 'ml_hyperparams':
        return ML_HYPERPARAM_SPACE;
      default:
        return STRATEGY_PARAM_SPACE;
    }
  }
  
  /**
   * Optimize strategy parameters
   */
  async optimizeStrategyParams(
    backtestFunction: (params: StrategyParams) => Promise<{ sharpe: number; winRate: number; pnl: number }>,
    targetMetric: 'sharpe' | 'winRate' | 'pnl' = 'sharpe',
    options: { symbol?: string; maxIterations?: number } = {}
  ): Promise<OptimizationResult> {
    const evaluator = async (params: Record<string, number | string>) => {
      const strategyParams: StrategyParams = {
        consensusThreshold: params.consensusThreshold as number,
        minConfidence: params.minConfidence as number,
        stopLoss: params.stopLoss as number,
        takeProfit: params.takeProfit as number,
        positionSize: params.positionSize as number,
        maxDrawdown: params.maxDrawdown as number
      };
      
      const result = await backtestFunction(strategyParams);
      return result[targetMetric];
    };
    
    const task = await this.startOptimization('strategy_params', targetMetric, evaluator, options);
    return task.result!;
  }
  
  /**
   * Optimize agent weights
   */
  async optimizeAgentWeights(
    evaluationFunction: (weights: AgentWeights) => Promise<number>,
    targetMetric: string = 'accuracy',
    options: { symbol?: string; maxIterations?: number } = {}
  ): Promise<OptimizationResult> {
    const evaluator = async (params: Record<string, number | string>) => {
      // Normalize weights to sum to 1
      const rawWeights = {
        technicalWeight: params.technicalWeight as number,
        sentimentWeight: params.sentimentWeight as number,
        fundamentalWeight: params.fundamentalWeight as number,
        volumeWeight: params.volumeWeight as number,
        momentumWeight: params.momentumWeight as number
      };
      
      const total = Object.values(rawWeights).reduce((sum, w) => sum + w, 0);
      const normalizedWeights: AgentWeights = {
        technicalWeight: rawWeights.technicalWeight / total,
        sentimentWeight: rawWeights.sentimentWeight / total,
        fundamentalWeight: rawWeights.fundamentalWeight / total,
        volumeWeight: rawWeights.volumeWeight / total,
        momentumWeight: rawWeights.momentumWeight / total
      };
      
      return evaluationFunction(normalizedWeights);
    };
    
    const task = await this.startOptimization('agent_weights', targetMetric, evaluator, options);
    return task.result!;
  }
  
  /**
   * Optimize risk parameters
   */
  async optimizeRiskParams(
    riskEvaluator: (params: RiskParams) => Promise<{ riskAdjustedReturn: number; maxDrawdown: number }>,
    options: { symbol?: string; maxIterations?: number } = {}
  ): Promise<OptimizationResult> {
    const evaluator = async (params: Record<string, number | string>) => {
      const riskParams: RiskParams = {
        maxPositionSize: params.maxPositionSize as number,
        maxDailyLoss: params.maxDailyLoss as number,
        maxDrawdown: params.maxDrawdown as number,
        riskPerTrade: params.riskPerTrade as number,
        correlationLimit: params.correlationLimit as number
      };
      
      const result = await riskEvaluator(riskParams);
      // Combine risk-adjusted return with drawdown penalty
      return result.riskAdjustedReturn - result.maxDrawdown * 0.5;
    };
    
    const task = await this.startOptimization('risk_params', 'risk_adjusted_return', evaluator, options);
    return task.result!;
  }
  
  /**
   * Optimize ML hyperparameters
   */
  async optimizeMLHyperparams(
    trainAndEvaluate: (params: MLHyperparams) => Promise<{ validationLoss: number; accuracy: number }>,
    options: { maxIterations?: number } = {}
  ): Promise<OptimizationResult> {
    const evaluator = async (params: Record<string, number | string>) => {
      const mlParams: MLHyperparams = {
        learningRate: params.learningRate as number,
        hiddenSize: params.hiddenSize as number,
        numLayers: params.numLayers as number,
        dropoutRate: params.dropoutRate as number,
        batchSize: params.batchSize as number
      };
      
      const result = await trainAndEvaluate(mlParams);
      // Minimize validation loss (negate for maximization)
      return -result.validationLoss + result.accuracy * 0.1;
    };
    
    const task = await this.startOptimization('ml_hyperparams', 'validation_loss', evaluator, options);
    return task.result!;
  }
  
  /**
   * Save task to database
   */
  private async saveTaskToDb(task: OptimizationTask): Promise<void> {
    const db = await getDb();
    if (!db) return;
    
    if (task.id && task.status !== 'pending') {
      await db.execute(sql`
        UPDATE parameterOptimizationHistory 
        SET status = ${task.status},
            iterationsCompleted = ${task.result?.totalIterations || 0},
            bestParameters = ${task.result ? JSON.stringify(task.result.bestParameters) : null},
            bestScore = ${task.result?.bestScore || null},
            endTime = ${task.endTime || null},
            error = ${task.error || null}
        WHERE id = ${task.id}
      `);
    } else {
      const result = await db.execute(sql`
        INSERT INTO parameterOptimizationHistory 
        (optimizationType, targetMetric, symbol, parameterSpace, totalIterations, status, startTime)
        VALUES (
          ${task.type}, ${task.targetMetric}, ${task.symbol || null},
          ${JSON.stringify(this.getParameterSpace(task.type))},
          50, ${task.status}, ${task.startTime || new Date()}
        )
      `);
      task.id = Number((result as any)[0].insertId);
    }
  }
  
  /**
   * Save optimization result to database
   */
  private async saveOptimizationResult(task: OptimizationTask, result: OptimizationResult): Promise<void> {
    const db = await getDb();
    if (!db) return;
    
    await db.execute(sql`
      UPDATE parameterOptimizationHistory 
      SET bestParameters = ${JSON.stringify(result.bestParameters)},
          bestScore = ${result.bestScore},
          iterationsCompleted = ${result.totalIterations},
          status = 'completed',
          endTime = NOW()
      WHERE id = ${task.id}
    `);
  }
  
  /**
   * Get active optimization tasks
   */
  getActiveTasks(): OptimizationTask[] {
    return Array.from(this.activeTasks.values());
  }
  
  /**
   * Get task by ID
   */
  getTask(taskId: number): OptimizationTask | undefined {
    return this.activeTasks.get(taskId);
  }
  
  /**
   * Get optimization history from database
   */
  async getOptimizationHistory(
    type?: OptimizationType,
    limit: number = 10
  ): Promise<Array<{
    id: number;
    type: string;
    targetMetric: string;
    bestScore: number | null;
    bestParameters: Record<string, any> | null;
    status: string;
    startTime: Date;
    endTime: Date | null;
  }>> {
    const db = await getDb();
    if (!db) return [];
    
    let query;
    if (type) {
      query = sql`
        SELECT * FROM parameterOptimizationHistory 
        WHERE optimizationType = ${type}
        ORDER BY startTime DESC LIMIT ${limit}
      `;
    } else {
      query = sql`
        SELECT * FROM parameterOptimizationHistory 
        ORDER BY startTime DESC LIMIT ${limit}
      `;
    }
    
    const result = await db.execute(query);
    const rows = (result as any)[0] as any[];
    
    return rows.map(row => ({
      id: row.id,
      type: row.optimizationType,
      targetMetric: row.targetMetric,
      bestScore: row.bestScore ? Number(row.bestScore) : null,
      bestParameters: row.bestParameters ? JSON.parse(row.bestParameters) : null,
      status: row.status,
      startTime: row.startTime,
      endTime: row.endTime
    }));
  }
  
  /**
   * Apply optimized parameters to system
   */
  async applyOptimizedParams(
    taskId: number,
    applyFunction: (params: Record<string, any>) => Promise<void>
  ): Promise<void> {
    const task = this.activeTasks.get(taskId);
    if (!task || task.status !== 'completed' || !task.result) {
      throw new Error('Task not found or not completed');
    }
    
    await applyFunction(task.result.bestParameters);
    console.log(`[SelfOptimizer] Applied optimized parameters from task ${taskId}`);
  }
}

export function getSelfOptimizer(): SelfOptimizer {
  return SelfOptimizer.getInstance();
}

export default SelfOptimizer;
