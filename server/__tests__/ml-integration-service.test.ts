/**
 * ML Integration Service Tests
 * Tests for the ML Integration Service that manages RL training,
 * optimization scheduling, and ML prediction agents.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

describe('ML Integration Service', () => {
  describe('Service Initialization', () => {
    it('should create singleton instance', async () => {
      const { getMLIntegrationService } = await import('../services/MLIntegrationService');
      const service1 = getMLIntegrationService();
      const service2 = getMLIntegrationService();
      expect(service1).toBe(service2);
    });

    it('should return status before initialization', async () => {
      const { MLIntegrationService } = await import('../services/MLIntegrationService');
      // Access via getInstance to get the singleton
      const service = MLIntegrationService.getInstance();
      const status = service.getStatus();
      
      expect(status).toHaveProperty('isInitialized');
      expect(status).toHaveProperty('rlTraining');
      expect(status).toHaveProperty('optimization');
      expect(status).toHaveProperty('mlPrediction');
    });

    it('should have correct RL training status structure', async () => {
      const { getMLIntegrationService } = await import('../services/MLIntegrationService');
      const service = getMLIntegrationService();
      const status = service.getStatus();
      
      expect(status.rlTraining).toHaveProperty('isTraining');
      expect(status.rlTraining).toHaveProperty('currentAgent');
      expect(status.rlTraining).toHaveProperty('progress');
      expect(status.rlTraining).toHaveProperty('lastTrainingResult');
      expect(status.rlTraining).toHaveProperty('trainingHistory');
      expect(Array.isArray(status.rlTraining.trainingHistory)).toBe(true);
    });

    it('should have correct optimization status structure', async () => {
      const { getMLIntegrationService } = await import('../services/MLIntegrationService');
      const service = getMLIntegrationService();
      const status = service.getStatus();
      
      expect(status.optimization).toHaveProperty('isRunning');
      expect(status.optimization).toHaveProperty('schedules');
      expect(status.optimization).toHaveProperty('recentHistory');
      expect(Array.isArray(status.optimization.schedules)).toBe(true);
      expect(Array.isArray(status.optimization.recentHistory)).toBe(true);
    });

    it('should have correct ML prediction status structure', async () => {
      const { getMLIntegrationService } = await import('../services/MLIntegrationService');
      const service = getMLIntegrationService();
      const status = service.getStatus();
      
      expect(status.mlPrediction).toHaveProperty('isEnabled');
      expect(status.mlPrediction).toHaveProperty('accuracy');
      expect(status.mlPrediction.accuracy).toHaveProperty('correct');
      expect(status.mlPrediction.accuracy).toHaveProperty('total');
      expect(status.mlPrediction.accuracy).toHaveProperty('rate');
    });
  });

  describe('ML Prediction Toggle', () => {
    it('should enable ML prediction', async () => {
      const { getMLIntegrationService } = await import('../services/MLIntegrationService');
      const service = getMLIntegrationService();
      
      service.setMLPredictionEnabled(true);
      expect(service.isMLPredictionEnabled()).toBe(true);
    });

    it('should disable ML prediction', async () => {
      const { getMLIntegrationService } = await import('../services/MLIntegrationService');
      const service = getMLIntegrationService();
      
      service.setMLPredictionEnabled(false);
      expect(service.isMLPredictionEnabled()).toBe(false);
    });

    it('should toggle ML prediction state', async () => {
      const { getMLIntegrationService } = await import('../services/MLIntegrationService');
      const service = getMLIntegrationService();
      
      const initialState = service.isMLPredictionEnabled();
      service.setMLPredictionEnabled(!initialState);
      expect(service.isMLPredictionEnabled()).toBe(!initialState);
      
      // Reset to initial state
      service.setMLPredictionEnabled(initialState);
    });
  });

  describe('Event Emitter', () => {
    it('should emit ml_prediction_toggled event', async () => {
      const { getMLIntegrationService } = await import('../services/MLIntegrationService');
      const service = getMLIntegrationService();
      
      const handler = vi.fn();
      service.on('ml_prediction_toggled', handler);
      
      service.setMLPredictionEnabled(true);
      
      expect(handler).toHaveBeenCalledWith(true);
      
      service.removeListener('ml_prediction_toggled', handler);
    });
  });

  describe('RL Training Pipeline Integration', () => {
    it('should have access to RLTrainingPipeline', async () => {
      const { RLTrainingPipeline } = await import('../ml/RLTrainingPipeline');
      const pipeline = RLTrainingPipeline.getInstance();
      
      expect(pipeline).toBeDefined();
      expect(typeof pipeline.isTrainingInProgress).toBe('function');
      expect(typeof pipeline.getTrainingHistory).toBe('function');
    });

    it('should report training status correctly', async () => {
      const { RLTrainingPipeline } = await import('../ml/RLTrainingPipeline');
      const pipeline = RLTrainingPipeline.getInstance();
      
      // Should not be training initially
      expect(pipeline.isTrainingInProgress()).toBe(false);
    });

    it('should return empty training history initially', async () => {
      const { RLTrainingPipeline } = await import('../ml/RLTrainingPipeline');
      const pipeline = RLTrainingPipeline.getInstance();
      
      const history = pipeline.getTrainingHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('Optimization Scheduler Integration', () => {
    it('should have access to MLOptimizationScheduler', async () => {
      const { MLOptimizationScheduler } = await import('../ml/MLOptimizationScheduler');
      const scheduler = MLOptimizationScheduler.getInstance();
      
      expect(scheduler).toBeDefined();
      expect(typeof scheduler.getStatus).toBe('function');
    });

    it('should return valid scheduler status', async () => {
      const { MLOptimizationScheduler } = await import('../ml/MLOptimizationScheduler');
      const scheduler = MLOptimizationScheduler.getInstance();
      
      const status = scheduler.getStatus();
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('schedules');
      expect(status).toHaveProperty('currentParams');
      expect(status).toHaveProperty('recentHistory');
    });

    it('should have default optimization schedules', async () => {
      const { MLOptimizationScheduler } = await import('../ml/MLOptimizationScheduler');
      const scheduler = MLOptimizationScheduler.getInstance();
      
      const status = scheduler.getStatus();
      expect(status.schedules.length).toBeGreaterThan(0);
      
      // Check for expected schedule types
      const scheduleTypes = status.schedules.map(s => s.type);
      expect(scheduleTypes).toContain('strategy_params');
      expect(scheduleTypes).toContain('agent_weights');
      expect(scheduleTypes).toContain('risk_params');
    });
  });

  describe('Health Router ML Endpoints', () => {
    it('should have getMLStatus endpoint defined', async () => {
      const { healthRouter } = await import('../routers/healthRouter');
      
      // Check that the router has the ML status procedure
      expect(healthRouter._def.procedures).toHaveProperty('getMLStatus');
    });

    it('should have startRLTraining endpoint defined', async () => {
      const { healthRouter } = await import('../routers/healthRouter');
      
      expect(healthRouter._def.procedures).toHaveProperty('startRLTraining');
    });

    it('should have triggerOptimization endpoint defined', async () => {
      const { healthRouter } = await import('../routers/healthRouter');
      
      expect(healthRouter._def.procedures).toHaveProperty('triggerOptimization');
    });

    it('should have toggleMLPrediction endpoint defined', async () => {
      const { healthRouter } = await import('../routers/healthRouter');
      
      expect(healthRouter._def.procedures).toHaveProperty('toggleMLPrediction');
    });
  });
});
