/**
 * ML Integration Service
 * 
 * Central service that manages all ML components:
 * - RL Agent Training (DQN/PPO)
 * - Weekly Optimization Scheduler
 * - ML Prediction Agent integration
 * 
 * This service is initialized on server startup and runs autonomously.
 */

import { EventEmitter } from 'events';
import { RLTrainingPipeline, TrainingProgress, TrainingResult } from '../ml/RLTrainingPipeline';
import { MLOptimizationScheduler } from '../ml/MLOptimizationScheduler';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';

export interface MLServiceStatus {
  isInitialized: boolean;
  rlTraining: {
    isTraining: boolean;
    currentAgent: 'dqn' | 'ppo' | null;
    progress: TrainingProgress | null;
    lastTrainingResult: TrainingResult | null;
    trainingHistory: TrainingResult[];
  };
  optimization: {
    isRunning: boolean;
    schedules: Array<{
      type: string;
      enabled: boolean;
      lastRun?: Date;
      nextRun?: Date;
    }>;
    recentHistory: Array<{
      type: string;
      status: string;
      startTime: Date;
      endTime?: Date;
    }>;
  };
  mlPrediction: {
    isEnabled: boolean;
    lastPrediction?: {
      symbol: string;
      direction: string;
      confidence: number;
      timestamp: Date;
    };
    accuracy: {
      correct: number;
      total: number;
      rate: number;
    };
  };
}

export class MLIntegrationService extends EventEmitter {
  private static instance: MLIntegrationService;
  private rlPipeline: RLTrainingPipeline;
  private optimizationScheduler: MLOptimizationScheduler;
  private isInitialized: boolean = false;
  private mlPredictionEnabled: boolean = false;
  private currentTrainingProgress: TrainingProgress | null = null;
  private lastTrainingResult: TrainingResult | null = null;

  private constructor() {
    super();
    this.rlPipeline = RLTrainingPipeline.getInstance();
    this.optimizationScheduler = MLOptimizationScheduler.getInstance();
    
    // Listen to training events
    this.rlPipeline.on('training_started', (data) => {
      console.log(`[MLIntegrationService] Training started: ${data.agentType}`);
      this.emit('training_started', data);
    });
    
    this.rlPipeline.on('episode_completed', (data) => {
      this.currentTrainingProgress = data;
      this.emit('training_progress', data);
    });
    
    this.rlPipeline.on('training_completed', (result: TrainingResult) => {
      console.log(`[MLIntegrationService] Training completed: ${result.agentType}`);
      this.lastTrainingResult = result;
      this.currentTrainingProgress = null;
      this.emit('training_completed', result);
    });
    
    // Listen to optimization events
    this.optimizationScheduler.on('optimization_started', (data) => {
      console.log(`[MLIntegrationService] Optimization started: ${data.type}`);
      this.emit('optimization_started', data);
    });
    
    this.optimizationScheduler.on('optimization_completed', (data) => {
      console.log(`[MLIntegrationService] Optimization completed: ${data.type}`);
      this.emit('optimization_completed', data);
    });
  }

  static getInstance(): MLIntegrationService {
    if (!MLIntegrationService.instance) {
      MLIntegrationService.instance = new MLIntegrationService();
    }
    return MLIntegrationService.instance;
  }

  /**
   * Initialize the ML Integration Service
   * Called on server startup
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('[MLIntegrationService] Already initialized');
      return;
    }

    console.log('[MLIntegrationService] Initializing ML Integration Service...');

    try {
      // Start the optimization scheduler
      await this.optimizationScheduler.start();
      console.log('[MLIntegrationService] Optimization scheduler started');

      // Check if we should auto-start RL training
      const shouldAutoTrain = await this.checkAutoTrainingEnabled();
      if (shouldAutoTrain) {
        console.log('[MLIntegrationService] Auto-training enabled, starting RL training...');
        // Start training in background (don't await)
        this.startRLTraining('BTC-USD').catch(err => {
          console.error('[MLIntegrationService] Auto-training failed:', err);
        });
      }

      // Enable ML prediction agent
      this.mlPredictionEnabled = true;

      this.isInitialized = true;
      console.log('[MLIntegrationService] ML Integration Service initialized successfully');
      this.emit('initialized');
    } catch (error) {
      console.error('[MLIntegrationService] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Check if auto-training is enabled in database
   */
  private async checkAutoTrainingEnabled(): Promise<boolean> {
    try {
      const db = await getDb();
      if (!db) return false;

      const { systemSettings } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const rows = await db.select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, 'ml_auto_training_enabled'))
        .limit(1);

      if (rows.length > 0 && rows[0].value) {
        return rows[0].value === 'true' || rows[0].value === '1';
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Start RL agent training
   */
  async startRLTraining(
    symbol: string = 'BTC-USD',
    agentType: 'dqn' | 'ppo' | 'both' = 'both',
    config?: {
      episodes?: number;
      maxStepsPerEpisode?: number;
      paperTradingValidation?: boolean;
    }
  ): Promise<TrainingResult[]> {
    console.log(`[MLIntegrationService] Starting RL training for ${symbol} with ${agentType} agent(s)`);
    
    const results: TrainingResult[] = [];
    
    const onProgress = (progress: TrainingProgress) => {
      this.currentTrainingProgress = progress;
      this.emit('training_progress', progress);
    };

    try {
      if (agentType === 'dqn' || agentType === 'both') {
        console.log('[MLIntegrationService] Training DQN agent...');
        const dqnResult = await this.rlPipeline.trainDQN(symbol, config, onProgress);
        results.push(dqnResult);
        console.log(`[MLIntegrationService] DQN training complete: Win Rate ${(dqnResult.winRate * 100).toFixed(1)}%`);
      }

      if (agentType === 'ppo' || agentType === 'both') {
        console.log('[MLIntegrationService] Training PPO agent...');
        const ppoResult = await this.rlPipeline.trainPPO(symbol, config, onProgress);
        results.push(ppoResult);
        console.log(`[MLIntegrationService] PPO training complete: Win Rate ${(ppoResult.winRate * 100).toFixed(1)}%`);
      }

      // Save training results to database
      await this.saveTrainingResults(results);

      this.emit('all_training_completed', results);
      return results;
    } catch (error) {
      console.error('[MLIntegrationService] Training failed:', error);
      throw error;
    }
  }

  /**
   * Save training results to database
   */
  private async saveTrainingResults(results: TrainingResult[]): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;

      for (const result of results) {
        await db.execute(sql`
          INSERT INTO mlTrainingHistory (
            agentType, episodes, finalReward, avgReward, bestReward,
            finalPnL, winRate, sharpe, trainingTime, createdAt
          ) VALUES (
            ${result.agentType},
            ${result.episodes},
            ${result.finalReward},
            ${result.avgReward},
            ${result.bestReward},
            ${result.finalPnL},
            ${result.winRate},
            ${result.sharpe},
            ${result.trainingTime},
            NOW()
          )
        `);
      }
      console.log(`[MLIntegrationService] Saved ${results.length} training results to database`);
    } catch (error) {
      console.warn('[MLIntegrationService] Failed to save training results:', error);
    }
  }

  /**
   * Trigger manual optimization
   */
  async triggerOptimization(type: 'strategy_params' | 'agent_weights' | 'risk_params' | 'ml_hyperparams'): Promise<void> {
    console.log(`[MLIntegrationService] Triggering manual optimization: ${type}`);
    await this.optimizationScheduler.runOptimization(type);
  }

  /**
   * Get current service status
   */
  getStatus(): MLServiceStatus {
    const optimizerStatus = this.optimizationScheduler.getStatus();
    const trainingHistory = this.rlPipeline.getTrainingHistory();

    return {
      isInitialized: this.isInitialized,
      rlTraining: {
        isTraining: this.rlPipeline.isTrainingInProgress(),
        currentAgent: this.currentTrainingProgress ? 
          (this.currentTrainingProgress as any).agentType || null : null,
        progress: this.currentTrainingProgress,
        lastTrainingResult: this.lastTrainingResult,
        trainingHistory
      },
      optimization: {
        isRunning: optimizerStatus.isRunning,
        schedules: optimizerStatus.schedules.map(s => ({
          type: s.type,
          enabled: s.enabled,
          lastRun: s.lastRun,
          nextRun: s.nextRun
        })),
        recentHistory: optimizerStatus.recentHistory.map(h => ({
          type: h.type,
          status: h.status,
          startTime: h.startTime,
          endTime: h.endTime
        }))
      },
      mlPrediction: {
        isEnabled: this.mlPredictionEnabled,
        accuracy: {
          correct: 0,
          total: 0,
          rate: 0
        }
      }
    };
  }

  /**
   * Enable/disable ML prediction agent
   */
  setMLPredictionEnabled(enabled: boolean): void {
    this.mlPredictionEnabled = enabled;
    console.log(`[MLIntegrationService] ML Prediction ${enabled ? 'enabled' : 'disabled'}`);
    this.emit('ml_prediction_toggled', enabled);
  }

  /**
   * Check if ML prediction is enabled
   */
  isMLPredictionEnabled(): boolean {
    return this.mlPredictionEnabled;
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    console.log('[MLIntegrationService] Shutting down...');
    await this.optimizationScheduler.stop();
    this.isInitialized = false;
    console.log('[MLIntegrationService] Shutdown complete');
  }
}

// Singleton getter
export function getMLIntegrationService(): MLIntegrationService {
  return MLIntegrationService.getInstance();
}
