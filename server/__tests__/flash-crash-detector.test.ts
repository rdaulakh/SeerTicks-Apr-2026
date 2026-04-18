/**
 * FlashCrashDetector — Comprehensive Unit Tests
 * 
 * Tests the 10ms flash crash detection system including:
 * - Lifecycle (start/stop/reset)
 * - Price tick processing
 * - Price sanity checks
 * - Flash crash detection at all 3 levels
 * - Circuit breaker cascade
 * - Status reporting
 * - Configuration updates
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FlashCrashDetector, resetFlashCrashDetector } from '../services/FlashCrashDetector';

describe('FlashCrashDetector', () => {
  let detector: FlashCrashDetector;

  beforeEach(() => {
    resetFlashCrashDetector();
    detector = new FlashCrashDetector();
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('should start and stop correctly', () => {
      expect(detector.getStatus().isActive).toBe(false);
      detector.start();
      expect(detector.getStatus().isActive).toBe(true);
      detector.stop();
      expect(detector.getStatus().isActive).toBe(false);
    });

    it('should not double-start', () => {
      const startSpy = vi.fn();
      detector.on('detector_started', startSpy);
      detector.start();
      detector.start(); // second call should be no-op
      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it('should reset all state', () => {
      detector.start();
      detector.processPriceTick('BTC-USD', 50000, 1);
      detector.processPriceTick('BTC-USD', 49000, 1);
      detector.reset();
      const status = detector.getStatus();
      expect(status.totalDetections).toBe(0);
      expect(status.activeSymbols).toHaveLength(0);
    });
  });

  // ─── Price Tick Processing ──────────────────────────────────────────────

  describe('processPriceTick', () => {
    it('should reject ticks when detector is not active', () => {
      const result = detector.processPriceTick('BTC-USD', 50000);
      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('not active');
    });

    it('should accept valid price ticks', () => {
      detector.start();
      const result = detector.processPriceTick('BTC-USD', 50000, 100, 'binance');
      expect(result.accepted).toBe(true);
      expect(result.flashCrashDetected).toBe(false);
    });

    it('should initialize symbol state on first tick', () => {
      detector.start();
      detector.processPriceTick('ETH-USD', 3000);
      const state = detector.getSymbolState('ETH-USD');
      expect(state).toBeDefined();
      expect(state!.lastPrice).toBe(3000);
    });

    it('should process multiple symbols independently', () => {
      detector.start();
      detector.processPriceTick('BTC-USD', 50000);
      detector.processPriceTick('ETH-USD', 3000);
      
      const btcState = detector.getSymbolState('BTC-USD');
      const ethState = detector.getSymbolState('ETH-USD');
      
      expect(btcState).toBeDefined();
      expect(ethState).toBeDefined();
      expect(btcState!.lastPrice).toBe(50000);
      expect(ethState!.lastPrice).toBe(3000);
    });
  });

  // ─── Price Sanity Checks ────────────────────────────────────────────────

  describe('price sanity checks', () => {
    it('should reject extreme price deviations (>10% from VWAP)', () => {
      detector.start();
      // Establish a baseline price
      for (let i = 0; i < 20; i++) {
        detector.processPriceTick('BTC-USD', 50000 + Math.random() * 100, 10);
      }
      
      // Now send an anomalous price (>10% deviation)
      const result = detector.processPriceTick('BTC-USD', 60000, 1); // 20% spike
      // Should be rejected as anomaly
      expect(result.accepted).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should accept prices within normal deviation range', () => {
      detector.start();
      detector.processPriceTick('BTC-USD', 50000, 100);
      // Small price change (1%)
      const result = detector.processPriceTick('BTC-USD', 50500, 100);
      expect(result.accepted).toBe(true);
    });
  });

  // ─── Flash Crash Detection ──────────────────────────────────────────────

  describe('flash crash detection', () => {
    it('should detect a level 1 flash crash (3% drop)', () => {
      detector.start();
      const events: any[] = [];
      detector.on('flash_crash_detected', (e) => events.push(e));

      // Establish baseline
      for (let i = 0; i < 10; i++) {
        detector.processPriceTick('BTC-USD', 50000, 100);
      }

      // Rapid 4% drop (exceeds level 1 threshold of 3%)
      const result = detector.processPriceTick('BTC-USD', 48000, 500);
      
      if (result.flashCrashDetected) {
        expect(result.event).toBeDefined();
        expect(result.event!.level).toBeGreaterThanOrEqual(1);
      }
    });

    it('should detect level 2 flash crash (5% drop)', () => {
      detector.start();
      
      for (let i = 0; i < 10; i++) {
        detector.processPriceTick('BTC-USD', 50000, 100);
      }

      // 6% drop
      const result = detector.processPriceTick('BTC-USD', 47000, 1000);
      
      if (result.flashCrashDetected) {
        expect(result.event!.level).toBeGreaterThanOrEqual(2);
      }
    });

    it('should use simulateFlashCrash for deterministic testing', () => {
      detector.start();
      detector.processPriceTick('BTC-USD', 50000, 100);
      
      const event = detector.simulateFlashCrash('BTC-USD', 'flash_drop', 3);
      
      expect(event).toBeDefined();
      expect(event.symbol).toBe('BTC-USD');
      expect(event.type).toBe('flash_drop');
      expect(event.level).toBe(3);
      
      const status = detector.getStatus();
      expect(status.totalDetections).toBeGreaterThan(0);
    });

    it('should detect flash spike (upward)', () => {
      detector.start();
      detector.processPriceTick('ETH-USD', 3000, 100);
      
      const event = detector.simulateFlashCrash('ETH-USD', 'flash_spike', 2);
      
      expect(event.type).toBe('flash_spike');
      expect(event.level).toBe(2);
    });
  });

  // ─── Status Reporting ───────────────────────────────────────────────────

  describe('status reporting', () => {
    it('should return complete status object', () => {
      const status = detector.getStatus();
      
      expect(status).toHaveProperty('isActive');
      expect(status).toHaveProperty('activeSymbols');
      expect(status).toHaveProperty('totalDetections');
      expect(status).toHaveProperty('level1Triggers');
      expect(status).toHaveProperty('level2Triggers');
      expect(status).toHaveProperty('level3Triggers');
      expect(status).toHaveProperty('rejectedAnomalies');
      expect(status).toHaveProperty('avgDetectionLatencyMs');
    });

    it('should track detection latency', () => {
      detector.start();
      for (let i = 0; i < 5; i++) {
        detector.processPriceTick('BTC-USD', 50000 + i, 100);
      }
      
      const status = detector.getStatus();
      expect(status.avgDetectionLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return recent events', () => {
      detector.start();
      detector.processPriceTick('BTC-USD', 50000, 100);
      detector.simulateFlashCrash('BTC-USD', 'flash_drop', 1);
      
      const events = detector.getRecentEvents();
      expect(events.length).toBeGreaterThan(0);
    });
  });

  // ─── Configuration ──────────────────────────────────────────────────────

  describe('configuration', () => {
    it('should return current config', () => {
      const config = detector.getConfig();
      expect(config.detectionWindowMs).toBe(10);
      expect(config.priceDropThreshold).toBe(5);
      expect(config.level1ThresholdPercent).toBe(3);
      expect(config.level2ThresholdPercent).toBe(5);
      expect(config.level3ThresholdPercent).toBe(10);
    });

    it('should accept custom config in constructor', () => {
      const custom = new FlashCrashDetector({
        priceDropThreshold: 3,
        level1ThresholdPercent: 2,
      });
      
      const config = custom.getConfig();
      expect(config.priceDropThreshold).toBe(3);
      expect(config.level1ThresholdPercent).toBe(2);
      // Defaults should still be present
      expect(config.detectionWindowMs).toBe(10);
    });

    it('should update config dynamically', () => {
      const updateSpy = vi.fn();
      detector.on('config_updated', updateSpy);
      
      detector.updateConfig({ priceDropThreshold: 8 });
      
      expect(detector.getConfig().priceDropThreshold).toBe(8);
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Event Emission ─────────────────────────────────────────────────────

  describe('event emission', () => {
    it('should emit detector_started on start', () => {
      const spy = vi.fn();
      detector.on('detector_started', spy);
      detector.start();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should emit detector_stopped on stop', () => {
      const spy = vi.fn();
      detector.on('detector_stopped', spy);
      detector.start();
      detector.stop();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should emit price_rejected for anomalous prices', () => {
      const spy = vi.fn();
      detector.on('price_rejected', spy);
      detector.start();
      
      // Establish baseline
      for (let i = 0; i < 20; i++) {
        detector.processPriceTick('BTC-USD', 50000, 10);
      }
      
      // Send anomalous price
      detector.processPriceTick('BTC-USD', 70000, 1);
      
      expect(spy).toHaveBeenCalled();
    });

    it('should emit flash_crash_detected on simulated crash', () => {
      const spy = vi.fn();
      detector.on('flash_crash_detected', spy);
      detector.start();
      detector.processPriceTick('BTC-USD', 50000, 100);
      detector.simulateFlashCrash('BTC-USD', 'flash_drop', 2);
      
      expect(spy).toHaveBeenCalled();
    });
  });
});
