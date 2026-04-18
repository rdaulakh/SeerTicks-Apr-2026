/**
 * Advanced AI/ML Router
 * 
 * Provides API endpoints for:
 * - Reinforcement Learning trading agents
 * - Neural network price predictions
 * - Self-optimizing parameter tuning
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { getRLAgentManager } from '../ml/rl/RLAgentManager';
import { EnsemblePredictor } from '../ml/nn/EnsemblePredictor';
import { getSelfOptimizer } from '../ml/optimization/SelfOptimizer';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';

// Singleton instances
let ensemblePredictor: EnsemblePredictor | null = null;

function getEnsemblePredictor(): EnsemblePredictor {
  if (!ensemblePredictor) {
    ensemblePredictor = new EnsemblePredictor({
      lstmWeight: 0.5,
      transformerWeight: 0.5,
      confidenceThreshold: 0.6,
      calibrationEnabled: true,
      adaptiveWeights: true
    });
  }
  return ensemblePredictor;
}

export const advancedAIRouter = router({
  // ==================== RL Agent Management ====================
  
  /**
   * Create a new RL trading agent
   */
  createRLAgent: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      agentType: z.enum(['dqn', 'ppo']),
      symbol: z.string().min(1).max(20),
      timeframe: z.string().default('1h'),
      config: z.object({
        stateSize: z.number().default(20),
        actionSize: z.number().default(4),
        hiddenSize: z.number().default(128),
        learningRate: z.number().default(0.001),
        gamma: z.number().default(0.99)
      }).optional()
    }))
    .mutation(async ({ input }) => {
      const manager = getRLAgentManager();
      
      const modelId = await manager.createModel({
        name: input.name,
        agentType: input.agentType,
        symbol: input.symbol,
        timeframe: input.timeframe,
        config: input.config || {},
        status: 'training'
      });
      
      return { 
        success: true, 
        modelId,
        message: `Created ${input.agentType.toUpperCase()} agent: ${input.name}`
      };
    }),
  
  /**
   * Get all RL models
   */
  getRLModels: protectedProcedure
    .query(async () => {
      const manager = getRLAgentManager();
      const models = await manager.getAllModels();
      
      // Get performance for each model
      const modelsWithPerformance = await Promise.all(
        models.map(async (model) => {
          const performance = model.id ? await manager.getModelPerformance(model.id) : null;
          return {
            ...model,
            performance
          };
        })
      );
      
      return modelsWithPerformance;
    }),
  
  /**
   * Train RL agent
   */
  trainRLAgent: protectedProcedure
    .input(z.object({
      modelId: z.number(),
      trainingData: z.array(z.object({
        timestamp: z.number(),
        open: z.number(),
        high: z.number(),
        low: z.number(),
        close: z.number(),
        volume: z.number()
      })),
      episodes: z.number().default(100)
    }))
    .mutation(async ({ input }) => {
      const manager = getRLAgentManager();
      
      // Load training data
      await manager.loadTrainingData(input.modelId, input.trainingData);
      
      // Get model to determine type
      const models = await manager.getAllModels();
      const model = models.find(m => m.id === input.modelId);
      
      if (!model) {
        throw new Error('Model not found');
      }
      
      let session;
      if (model.agentType === 'dqn') {
        session = await manager.trainDQN(input.modelId, input.episodes);
      } else {
        session = await manager.trainPPO(input.modelId, input.episodes * 1000);
      }
      
      return {
        success: true,
        session: {
          modelId: session.modelId,
          episodes: session.episodes,
          totalTimesteps: session.totalTimesteps,
          finalMetrics: session.finalMetrics,
          status: session.status
        }
      };
    }),
  
  /**
   * Get RL trading signal
   */
  getRLSignal: protectedProcedure
    .input(z.object({
      modelId: z.number(),
      currentState: z.array(z.number())
    }))
    .query(async ({ input }) => {
      const manager = getRLAgentManager();
      const signal = await manager.getSignal(input.modelId, input.currentState);
      
      return signal;
    }),
  
  /**
   * Delete RL model
   */
  deleteRLModel: protectedProcedure
    .input(z.object({
      modelId: z.number()
    }))
    .mutation(async ({ input }) => {
      const manager = getRLAgentManager();
      await manager.deleteModel(input.modelId);
      
      return { success: true };
    }),
  
  // ==================== Neural Network Predictions ====================
  
  /**
   * Get price prediction from ensemble model
   */
  getPricePrediction: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      candles: z.array(z.object({
        open: z.number(),
        high: z.number(),
        low: z.number(),
        close: z.number(),
        volume: z.number()
      }))
    }))
    .query(async ({ input }) => {
      const predictor = getEnsemblePredictor();
      
      if (input.candles.length < 61) {
        throw new Error('Need at least 61 candles for prediction');
      }
      
      const prediction = predictor.predict(input.candles);
      
      return {
        predictedPrice: prediction.predictedPrice,
        predictedDirection: prediction.predictedDirection,
        confidence: prediction.confidence,
        priceChange: prediction.priceChange,
        modelAgreement: prediction.modelAgreement,
        calibratedConfidence: prediction.calibratedConfidence,
        timestamp: prediction.timestamp,
        targetTimestamp: prediction.targetTimestamp,
        individualPredictions: {
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
        }
      };
    }),
  
  /**
   * Get model accuracy statistics
   */
  getPredictionAccuracy: protectedProcedure
    .query(async () => {
      const predictor = getEnsemblePredictor();
      const stats = predictor.getAccuracyStats();
      
      return {
        lstm: stats.get('lstm'),
        transformer: stats.get('transformer'),
        ensemble: stats.get('ensemble'),
        modelWeights: predictor.getModelWeights()
      };
    }),
  
  /**
   * Update prediction with actual outcome
   */
  updatePredictionOutcome: protectedProcedure
    .input(z.object({
      predictionTimestamp: z.string(),
      actualPrice: z.number(),
      symbol: z.string()
    }))
    .mutation(async ({ input }) => {
      const predictor = getEnsemblePredictor();
      await predictor.updateWithActual(
        new Date(input.predictionTimestamp),
        input.actualPrice,
        input.symbol
      );
      
      return { success: true };
    }),
  
  /**
   * Get prediction history
   */
  getPredictionHistory: protectedProcedure
    .input(z.object({
      symbol: z.string().optional(),
      limit: z.number().default(50)
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      
      let query;
      if (input.symbol) {
        query = sql`
          SELECT * FROM nnPredictions 
          WHERE symbol = ${input.symbol}
          ORDER BY predictionTimestamp DESC 
          LIMIT ${input.limit}
        `;
      } else {
        query = sql`
          SELECT * FROM nnPredictions 
          ORDER BY predictionTimestamp DESC 
          LIMIT ${input.limit}
        `;
      }
      
      const result = await db.execute(query);
      return (result as any)[0];
    }),
  
  // ==================== Self-Optimization ====================
  
  /**
   * Start parameter optimization
   */
  startOptimization: protectedProcedure
    .input(z.object({
      type: z.enum(['strategy_params', 'agent_weights', 'risk_params', 'ml_hyperparams']),
      targetMetric: z.string(),
      symbol: z.string().optional(),
      maxIterations: z.number().default(50)
    }))
    .mutation(async ({ input }) => {
      const optimizer = getSelfOptimizer();
      
      // Create a mock evaluator for demonstration
      // In production, this would run actual backtests
      const mockEvaluator = async (params: Record<string, number | string>) => {
        // Simulate evaluation with some randomness
        const baseScore = 0.5;
        const paramInfluence = Object.values(params)
          .filter((v): v is number => typeof v === 'number')
          .reduce((sum, v) => sum + v * 0.1, 0);
        
        return baseScore + paramInfluence + (Math.random() - 0.5) * 0.2;
      };
      
      const task = await optimizer.startOptimization(
        input.type,
        input.targetMetric,
        mockEvaluator,
        {
          symbol: input.symbol,
          maxIterations: input.maxIterations
        }
      );
      
      return {
        taskId: task.id,
        status: task.status,
        type: task.type,
        targetMetric: task.targetMetric
      };
    }),
  
  /**
   * Get optimization status
   */
  getOptimizationStatus: protectedProcedure
    .input(z.object({
      taskId: z.number()
    }))
    .query(async ({ input }) => {
      const optimizer = getSelfOptimizer();
      const task = optimizer.getTask(input.taskId);
      
      if (!task) {
        throw new Error('Task not found');
      }
      
      return {
        id: task.id,
        type: task.type,
        targetMetric: task.targetMetric,
        status: task.status,
        progress: task.progress,
        result: task.result ? {
          bestParameters: task.result.bestParameters,
          bestScore: task.result.bestScore,
          totalIterations: task.result.totalIterations,
          convergenceIteration: task.result.convergenceIteration
        } : null,
        error: task.error
      };
    }),
  
  /**
   * Get optimization history
   */
  getOptimizationHistory: protectedProcedure
    .input(z.object({
      type: z.enum(['strategy_params', 'agent_weights', 'risk_params', 'ml_hyperparams']).optional(),
      limit: z.number().default(10)
    }))
    .query(async ({ input }) => {
      const optimizer = getSelfOptimizer();
      return optimizer.getOptimizationHistory(input.type, input.limit);
    }),
  
  /**
   * Get active optimization tasks
   */
  getActiveOptimizations: protectedProcedure
    .query(async () => {
      const optimizer = getSelfOptimizer();
      return optimizer.getActiveTasks();
    }),
  
  // ==================== Dashboard Summary ====================
  
  /**
   * Get AI/ML dashboard summary
   */
  getDashboardSummary: protectedProcedure
    .query(async () => {
      const rlManager = getRLAgentManager();
      const predictor = getEnsemblePredictor();
      const optimizer = getSelfOptimizer();
      
      // Get RL models summary
      const rlModels = await rlManager.getAllModels();
      const activeRLModels = rlModels.filter(m => m.status === 'live' || m.status === 'paper_trading');
      
      // Get prediction accuracy
      const predictionStats = predictor.getAccuracyStats();
      const ensembleAccuracy = predictionStats.get('ensemble');
      
      // Get active optimizations
      const activeOptimizations = optimizer.getActiveTasks();
      
      // Get recent optimization history
      const recentOptimizations = await optimizer.getOptimizationHistory(undefined, 5);
      
      return {
        rlAgents: {
          total: rlModels.length,
          active: activeRLModels.length,
          types: {
            dqn: rlModels.filter(m => m.agentType === 'dqn').length,
            ppo: rlModels.filter(m => m.agentType === 'ppo').length
          }
        },
        predictions: {
          totalPredictions: ensembleAccuracy?.totalPredictions || 0,
          accuracy: ensembleAccuracy ? 
            (ensembleAccuracy.correctDirections / ensembleAccuracy.totalPredictions * 100).toFixed(1) : '0',
          avgConfidence: ensembleAccuracy?.avgConfidence?.toFixed(2) || '0',
          modelWeights: predictor.getModelWeights()
        },
        optimization: {
          activeCount: activeOptimizations.length,
          recentCompleted: recentOptimizations.filter(o => o.status === 'completed').length,
          avgImprovement: recentOptimizations
            .filter(o => o.bestScore !== null)
            .reduce((sum, o) => sum + (o.bestScore || 0), 0) / 
            Math.max(1, recentOptimizations.filter(o => o.bestScore !== null).length)
        },
        systemHealth: {
          rlSystemReady: rlModels.length > 0,
          predictionSystemReady: true,
          optimizationSystemReady: true
        }
      };
    }),
  
  /**
   * Get RL training history
   */
  getRLTrainingHistory: protectedProcedure
    .input(z.object({
      modelId: z.number().optional(),
      limit: z.number().default(20)
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      
      let query;
      if (input.modelId) {
        query = sql`
          SELECT * FROM rlTrainingHistory 
          WHERE modelId = ${input.modelId}
          ORDER BY startTime DESC 
          LIMIT ${input.limit}
        `;
      } else {
        query = sql`
          SELECT * FROM rlTrainingHistory 
          ORDER BY startTime DESC 
          LIMIT ${input.limit}
        `;
      }
      
      const result = await db.execute(query);
      return (result as any)[0];
    })
});

export default advancedAIRouter;
