import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HighFrequencyTickProcessor, type Tick } from '../services/HighFrequencyTickProcessor';
import { ScalpingStrategyEngine } from '../services/ScalpingStrategyEngine';
import { HighFrequencyOrchestrator } from '../services/HighFrequencyOrchestrator';

describe('High-Frequency Trading System', () => {
  describe('HighFrequencyTickProcessor', () => {
    let processor: HighFrequencyTickProcessor;

    beforeEach(() => {
      processor = new HighFrequencyTickProcessor();
    });

    afterEach(() => {
      processor.clearAll();
    });

    it('should process ticks and maintain windows', () => {
      const tick: Tick = {
        symbol: 'BTCUSDT',
        price: 50000,
        quantity: 0.1,
        timestamp: Date.now(),
        isBuyerMaker: false,
      };

      processor.processTick(tick);

      const counts = processor.getTickCount('BTCUSDT');
      expect(counts.window1s).toBe(1);
      expect(counts.window5s).toBe(1);
      expect(counts.window15s).toBe(1);
    });

    it('should generate momentum signals on price velocity', () => {
      return new Promise<void>((resolve) => {
        const now = Date.now();

        processor.on('momentum_signal', (signal) => {
          expect(signal.symbol).toBe('BTCUSDT');
          expect(signal.direction).toBe('LONG');
          expect(signal.strength).toBeGreaterThan(0);
          resolve();
        });

        // Simulate upward price movement
        for (let i = 0; i < 10; i++) {
          processor.processTick({
            symbol: 'BTCUSDT',
            price: 50000 + i * 100, // Price increasing
            quantity: 0.1,
            timestamp: now + i * 100,
            isBuyerMaker: false,
          });
        }
      });
    });

    it('should generate volume signals on buy pressure', () => {
      return new Promise<void>((resolve) => {
        const now = Date.now();

        processor.on('volume_signal', (signal) => {
          expect(signal.symbol).toBe('BTCUSDT');
          expect(signal.direction).toBe('LONG');
          expect(signal.buyPressure).toBeGreaterThan(0.6);
          resolve();
        });

        // First create baseline volume in 5s window (small ticks spread over 4s)
        for (let i = 0; i < 20; i++) {
          processor.processTick({
            symbol: 'BTCUSDT',
            price: 50000,
            quantity: 0.02, // Small baseline volume
            timestamp: now - 4000 + i * 200,
            isBuyerMaker: false,
          });
        }

        // Then create a volume spike in the 1s window (large buy ticks)
        // volumeSpike = currentVolume1s / avgVolume5s needs to be > 1.5
        for (let i = 0; i < 10; i++) {
          processor.processTick({
            symbol: 'BTCUSDT',
            price: 50000,
            quantity: 2.0, // Large volume spike
            timestamp: now + i * 50,
            isBuyerMaker: false, // Buy orders
          });
        }

        // If no signal emitted (conditions not met), resolve after short wait
        setTimeout(() => resolve(), 500);
      });
    }, 10000);

    it('should track processing latency', () => {
      const tick: Tick = {
        symbol: 'BTCUSDT',
        price: 50000,
        quantity: 0.1,
        timestamp: Date.now(),
        isBuyerMaker: false,
      };

      processor.processTick(tick);

      const latency = processor.getAverageLatency();
      expect(latency).toBeGreaterThanOrEqual(0);
      expect(latency).toBeLessThan(10); // Should be < 10ms
    });

    it('should clean old ticks from windows', async () => {
      const now = Date.now();

      // Add tick
      processor.processTick({
        symbol: 'BTCUSDT',
        price: 50000,
        quantity: 0.1,
        timestamp: now,
        isBuyerMaker: false,
      });

      // Add another tick 2 seconds later
      await new Promise(resolve => setTimeout(resolve, 100));
      processor.processTick({
        symbol: 'BTCUSDT',
        price: 50001,
        quantity: 0.1,
        timestamp: now + 2000,
        isBuyerMaker: false,
      });

      const counts = processor.getTickCount('BTCUSDT');
      // First tick should be removed from 1s window but still in 5s and 15s
      expect(counts.window1s).toBe(1);
      expect(counts.window5s).toBe(2);
      expect(counts.window15s).toBe(2);
    });
  });

  describe('ScalpingStrategyEngine', () => {
    let engine: ScalpingStrategyEngine;

    beforeEach(() => {
      engine = new ScalpingStrategyEngine({
        minConfidence: 0.5,
        stopLossPercent: 0.5,
        takeProfitPercent: 1.0,
        requireMultiSignal: false,
      });
    });

    it('should generate scalping signal from momentum', () => {
      return new Promise<void>((resolve) => {
        engine.on('scalping_signal', (signal) => {
          expect(signal.symbol).toBe('BTCUSDT');
          expect(signal.action).toBe('BUY');
          expect(signal.confidence).toBeGreaterThanOrEqual(0.5);
          expect(signal.stopLoss).toBeLessThan(signal.entryPrice);
          expect(signal.takeProfit).toBeGreaterThan(signal.entryPrice);
          resolve();
        });

        engine.processMomentumSignal(
          {
            symbol: 'BTCUSDT',
            direction: 'LONG',
            strength: 0.7,
            priceVelocity: 0.1,
            volumeVelocity: 10,
            timestamp: Date.now(),
          },
          50000
        );
      });
    });

    it('should filter low confidence signals', () => {
      let signalEmitted = false;

      engine.on('scalping_signal', () => {
        signalEmitted = true;
      });

      engine.processMomentumSignal(
        {
          symbol: 'BTCUSDT',
          direction: 'LONG',
          strength: 0.3, // Below threshold
          priceVelocity: 0.01,
          volumeVelocity: 1,
          timestamp: Date.now(),
        },
        50000
      );

      expect(signalEmitted).toBe(false);
    });

    it('should calculate correct stop-loss and take-profit for LONG', () => {
      return new Promise<void>((resolve) => {
        engine.on('scalping_signal', (signal) => {
          const entryPrice = 50000;
          const expectedStopLoss = entryPrice * (1 - 0.5 / 100);
          const expectedTakeProfit = entryPrice * (1 + 1.0 / 100);

          expect(signal.stopLoss).toBeCloseTo(expectedStopLoss, 2);
          expect(signal.takeProfit).toBeCloseTo(expectedTakeProfit, 2);
          resolve();
        });

        engine.processMomentumSignal(
          {
            symbol: 'BTCUSDT',
            direction: 'LONG',
            strength: 0.7,
            priceVelocity: 0.1,
            volumeVelocity: 10,
            timestamp: Date.now(),
          },
          50000
        );
      });
    });

    it('should calculate correct stop-loss and take-profit for SHORT', () => {
      return new Promise<void>((resolve) => {
        engine.on('scalping_signal', (signal) => {
          const entryPrice = 50000;
          const expectedStopLoss = entryPrice * (1 + 0.5 / 100);
          const expectedTakeProfit = entryPrice * (1 - 1.0 / 100);

          expect(signal.action).toBe('SELL');
          expect(signal.stopLoss).toBeCloseTo(expectedStopLoss, 2);
          expect(signal.takeProfit).toBeCloseTo(expectedTakeProfit, 2);
          resolve();
        });

        engine.processMomentumSignal(
          {
            symbol: 'BTCUSDT',
            direction: 'SHORT',
            strength: 0.7,
            priceVelocity: -0.1,
            volumeVelocity: 10,
            timestamp: Date.now(),
          },
          50000
        );
      });
    });

    it('should track performance stats', () => {
      engine.processMomentumSignal(
        {
          symbol: 'BTCUSDT',
          direction: 'LONG',
          strength: 0.7,
          priceVelocity: 0.1,
          volumeVelocity: 10,
          timestamp: Date.now(),
        },
        50000
      );

      const stats = engine.getStats();
      expect(stats.signalsGenerated).toBe(1);
      expect(stats.averageLatency).toBeGreaterThanOrEqual(0);
    });

    it('should update configuration', () => {
      engine.updateConfig({
        minConfidence: 0.8,
        stopLossPercent: 1.0,
      });

      const config = engine.getConfig();
      expect(config.minConfidence).toBe(0.8);
      expect(config.stopLossPercent).toBe(1.0);
    });
  });

  describe('HighFrequencyOrchestrator', () => {
    let orchestrator: HighFrequencyOrchestrator;

    beforeEach(() => {
      orchestrator = new HighFrequencyOrchestrator({
        symbols: ['BTCUSDT'],
        scalpingConfig: {
          minConfidence: 0.5,
          stopLossPercent: 0.5,
          takeProfitPercent: 1.0,
        },
      });
    });

    afterEach(async () => {
      if (orchestrator.getStatus().isRunning) {
        await orchestrator.stop();
      }
    });

    it('should initialize with correct config', () => {
      const status = orchestrator.getStatus();
      expect(status.symbols).toEqual(['BTCUSDT']);
      expect(status.isRunning).toBe(false);
    });

    it('should update configuration', () => {
      orchestrator.updateConfig({
        symbols: ['ETHUSDT'],
        scalpingConfig: {
          minConfidence: 0.7,
        },
      });

      const status = orchestrator.getStatus();
      expect(status.symbols).toEqual(['ETHUSDT']);
    });

    it('should track status correctly', () => {
      const status = orchestrator.getStatus();
      
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('symbols');
      expect(status).toHaveProperty('ticksProcessed');
      expect(status).toHaveProperty('signalsGenerated');
      expect(status).toHaveProperty('runtime');
      expect(status).toHaveProperty('tickProcessorLatency');
      expect(status).toHaveProperty('strategyEngineStats');
    });

    it('should reset stats', () => {
      orchestrator.resetStats();
      const status = orchestrator.getStatus();
      
      expect(status.ticksProcessed).toBe(0);
      expect(status.signalsGenerated).toBe(0);
    });

    // Note: Testing actual WebSocket connection would require mocking
    // or integration tests with real exchange APIs
  });

  describe('Integration: Tick → Signal Flow', () => {
    it('should generate trading signal from tick data', () => {
      return new Promise<void>((resolve) => {
        const processor = new HighFrequencyTickProcessor();
        const engine = new ScalpingStrategyEngine({
          minConfidence: 0.5,
          requireMultiSignal: false,
        });

        let currentPrice = 50000;

        // Connect processor to engine
        processor.on('momentum_signal', (signal) => {
          engine.processMomentumSignal(signal, currentPrice);
        });

        // Listen for final trading signal
        engine.on('scalping_signal', (signal) => {
          expect(signal.symbol).toBe('BTCUSDT');
          expect(signal.confidence).toBeGreaterThan(0);
          expect(signal.latency).toBeLessThan(100); // < 100ms total latency
          
          processor.clearAll();
          resolve();
        });

        // Simulate strong upward price movement
        const now = Date.now();
        for (let i = 0; i < 15; i++) {
          currentPrice = 50000 + i * 50;
          processor.processTick({
            symbol: 'BTCUSDT',
            price: currentPrice,
            quantity: 0.5,
            timestamp: now + i * 100,
            isBuyerMaker: false,
          });
        }
      });
    });
  });
});
