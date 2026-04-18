/**
 * ML Integration Tests
 * 
 * Tests for the ML recommendation implementations:
 * 1. MLPredictionAgent - EnsemblePredictor wrapper
 * 2. MLOptimizationScheduler - Weekly strategy tuning
 * 3. RLTrainingPipeline - RL agent training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue({
    execute: vi.fn().mockResolvedValue([[]])
  })
}));

describe('ML Integration', () => {
  describe('MLPredictionAgent', () => {
    it('should be importable', async () => {
      const { MLPredictionAgent } = await import('../agents/MLPredictionAgent');
      expect(MLPredictionAgent).toBeDefined();
    });

    it('should create an instance', async () => {
      const { MLPredictionAgent } = await import('../agents/MLPredictionAgent');
      const agent = new MLPredictionAgent();
      expect(agent).toBeDefined();
    });

    it('should be an instance of AgentBase', async () => {
      const { MLPredictionAgent } = await import('../agents/MLPredictionAgent');
      const { AgentBase } = await import('../agents/AgentBase');
      const agent = new MLPredictionAgent();
      expect(agent instanceof AgentBase).toBe(true);
    });

    it('should have analyze method', async () => {
      const { MLPredictionAgent } = await import('../agents/MLPredictionAgent');
      const agent = new MLPredictionAgent();
      expect(typeof agent.analyze).toBe('function');
    });
  });

  describe('MLOptimizationScheduler', () => {
    it('should be importable', async () => {
      const { MLOptimizationScheduler } = await import('../ml/MLOptimizationScheduler');
      expect(MLOptimizationScheduler).toBeDefined();
    });

    it('should create an instance', async () => {
      const { MLOptimizationScheduler } = await import('../ml/MLOptimizationScheduler');
      const scheduler = new MLOptimizationScheduler();
      expect(scheduler).toBeDefined();
    });

    it('should have start and stop methods', async () => {
      const { MLOptimizationScheduler } = await import('../ml/MLOptimizationScheduler');
      const scheduler = new MLOptimizationScheduler();
      expect(typeof scheduler.start).toBe('function');
      expect(typeof scheduler.stop).toBe('function');
    });

    it('should have getStatus method', async () => {
      const { MLOptimizationScheduler } = await import('../ml/MLOptimizationScheduler');
      const scheduler = new MLOptimizationScheduler();
      expect(typeof scheduler.getStatus).toBe('function');
    });

    it('should return correct status structure', async () => {
      const { MLOptimizationScheduler } = await import('../ml/MLOptimizationScheduler');
      const scheduler = new MLOptimizationScheduler();
      const status = scheduler.getStatus();
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('schedules');
      expect(status).toHaveProperty('recentHistory');
      expect(status).toHaveProperty('currentParams');
    });

  });

  describe('RLTrainingPipeline', () => {
    it('should be importable', async () => {
      const { RLTrainingPipeline } = await import('../ml/RLTrainingPipeline');
      expect(RLTrainingPipeline).toBeDefined();
    });

    it('should create an instance', async () => {
      const { RLTrainingPipeline } = await import('../ml/RLTrainingPipeline');
      const pipeline = new RLTrainingPipeline();
      expect(pipeline).toBeDefined();
    });

    it('should have trainDQN method', async () => {
      const { RLTrainingPipeline } = await import('../ml/RLTrainingPipeline');
      const pipeline = new RLTrainingPipeline();
      expect(typeof pipeline.trainDQN).toBe('function');
    });

    it('should have trainPPO method', async () => {
      const { RLTrainingPipeline } = await import('../ml/RLTrainingPipeline');
      const pipeline = new RLTrainingPipeline();
      expect(typeof pipeline.trainPPO).toBe('function');
    });
  });

  describe('EnsemblePredictor', () => {
    it('should be importable', async () => {
      const { EnsemblePredictor } = await import('../ml/nn/EnsemblePredictor');
      expect(EnsemblePredictor).toBeDefined();
    });

    it('should create an instance', async () => {
      const { EnsemblePredictor } = await import('../ml/nn/EnsemblePredictor');
      const predictor = new EnsemblePredictor();
      expect(predictor).toBeDefined();
    });

    it('should have predict method', async () => {
      const { EnsemblePredictor } = await import('../ml/nn/EnsemblePredictor');
      const predictor = new EnsemblePredictor();
      expect(typeof predictor.predict).toBe('function');
    });
  });

  describe('DQNAgent', () => {
    it('should be importable', async () => {
      const { DQNAgent } = await import('../ml/rl/DQNAgent');
      expect(DQNAgent).toBeDefined();
    });

    it('should create an instance with default config', async () => {
      const { DQNAgent } = await import('../ml/rl/DQNAgent');
      const agent = new DQNAgent();
      expect(agent).toBeDefined();
    });

    it('should have selectAction method', async () => {
      const { DQNAgent } = await import('../ml/rl/DQNAgent');
      const agent = new DQNAgent();
      expect(typeof agent.selectAction).toBe('function');
    });

    it('should have train method', async () => {
      const { DQNAgent } = await import('../ml/rl/DQNAgent');
      const agent = new DQNAgent();
      expect(typeof agent.train).toBe('function');
    });
  });

  describe('PPOAgent', () => {
    it('should be importable', async () => {
      const { PPOAgent } = await import('../ml/rl/PPOAgent');
      expect(PPOAgent).toBeDefined();
    });

    it('should create an instance with default config', async () => {
      const { PPOAgent } = await import('../ml/rl/PPOAgent');
      const agent = new PPOAgent();
      expect(agent).toBeDefined();
    });

    it('should have selectAction method', async () => {
      const { PPOAgent } = await import('../ml/rl/PPOAgent');
      const agent = new PPOAgent();
      expect(typeof agent.selectAction).toBe('function');
    });

    it('should have update method', async () => {
      const { PPOAgent } = await import('../ml/rl/PPOAgent');
      const agent = new PPOAgent();
      expect(typeof agent.update).toBe('function');
    });
  });

  describe('SelfOptimizer', () => {
    it('should be importable', async () => {
      const { SelfOptimizer } = await import('../ml/optimization/SelfOptimizer');
      expect(SelfOptimizer).toBeDefined();
    });

    it('should create an instance', async () => {
      const { SelfOptimizer } = await import('../ml/optimization/SelfOptimizer');
      const optimizer = new SelfOptimizer();
      expect(optimizer).toBeDefined();
    });

    it('should have startOptimization method', async () => {
      const { SelfOptimizer } = await import('../ml/optimization/SelfOptimizer');
      const optimizer = new SelfOptimizer();
      expect(typeof optimizer.startOptimization).toBe('function');
    });
  });

  describe('BayesianOptimizer', () => {
    it('should be importable', async () => {
      const { BayesianOptimizer } = await import('../ml/optimization/BayesianOptimizer');
      expect(BayesianOptimizer).toBeDefined();
    });

    it('should create an instance', async () => {
      const { BayesianOptimizer } = await import('../ml/optimization/BayesianOptimizer');
      const optimizer = new BayesianOptimizer({
        parameterSpace: [
          { name: 'test', min: 0, max: 1, type: 'continuous' }
        ]
      });
      expect(optimizer).toBeDefined();
    });

    it('should have optimize method', async () => {
      const { BayesianOptimizer } = await import('../ml/optimization/BayesianOptimizer');
      const optimizer = new BayesianOptimizer({
        parameterSpace: [
          { name: 'test', min: 0, max: 1, type: 'continuous' }
        ]
      });
      expect(typeof optimizer.optimize).toBe('function');
    });
  });
});
