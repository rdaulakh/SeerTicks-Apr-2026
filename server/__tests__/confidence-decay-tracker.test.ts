/**
 * Comprehensive tests for ConfidenceDecayTracker
 * 
 * Tests the institutional-grade confidence-decay exit system:
 * - Proportional decay calculation
 * - Adaptive decay ratios based on P&L
 * - Floor protection (never below entry)
 * - Momentum detection
 * - Time decay
 * 
 * Key config values (current):
 * - baseDecayRatio: 0.70 (profitable positions)
 * - losingDecayRatio: 0.50 (losing positions, but deferred to hard exit if pnl < -0.3%)
 * - deepLossDecayRatio: 0.35 (deep loss, also deferred)
 * - minHoldSecondsForDecayExit: 60 (no decay exits within first 60s)
 * - floorBuffer: 0.00
 * - Losing positions (pnl < -0.3%) are deferred to PriorityExitManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfidenceDecayTracker, ConfidenceDecayConfig } from '../services/ConfidenceDecayTracker';

describe('ConfidenceDecayTracker', () => {
  let tracker: ConfidenceDecayTracker;
  
  beforeEach(() => {
    tracker = new ConfidenceDecayTracker();
  });
  
  describe('Position Registration', () => {
    it('should register a new position with entry confidence', () => {
      tracker.registerPosition('pos1', 'BTC-USD', 0.72);
      
      // First update at entry level
      const result = tracker.updateConfidence('pos1', 0.72, 0);
      const stats = tracker.getPositionStats('pos1');
      expect(stats?.entryConfidence).toBe(0.72);
      expect(result.peakConfidence).toBe(0.72);
      expect(result.currentConfidence).toBe(0.72);
    });
    
    it('should handle multiple positions independently', () => {
      tracker.registerPosition('pos1', 'BTC-USD', 0.70);
      tracker.registerPosition('pos2', 'ETH-USD', 0.75);
      
      tracker.updateConfidence('pos1', 0.70, 0);
      tracker.updateConfidence('pos2', 0.75, 0);
      
      const stats1 = tracker.getPositionStats('pos1');
      const stats2 = tracker.getPositionStats('pos2');
      
      expect(stats1?.entryConfidence).toBe(0.70);
      expect(stats2?.entryConfidence).toBe(0.75);
    });
    
    it('should remove position and clean up', () => {
      tracker.registerPosition('pos1', 'BTC-USD', 0.70);
      tracker.removePosition('pos1');
      
      const result = tracker.updateConfidence('pos1', 0.70, 0);
      expect(result.shouldExit).toBe(false);
      expect(result.reason).toBe('Position not tracked');
    });
  });
  
  describe('Peak Confidence Tracking', () => {
    it('should track peak confidence as it increases', () => {
      tracker.registerPosition('pos1', 'BTC-USD', 0.65);
      
      // Confidence increases
      tracker.updateConfidence('pos1', 0.70, 0.5);
      tracker.updateConfidence('pos1', 0.75, 1.0);
      const result = tracker.updateConfidence('pos1', 0.80, 1.5);
      
      expect(result.peakConfidence).toBe(0.80);
    });
    
    it('should not decrease peak when confidence drops', () => {
      tracker.registerPosition('pos1', 'BTC-USD', 0.65);
      
      // Confidence increases then decreases
      tracker.updateConfidence('pos1', 0.80, 1.0);
      const result = tracker.updateConfidence('pos1', 0.70, 0.5);
      
      expect(result.peakConfidence).toBe(0.80);
      expect(result.currentConfidence).toBe(0.70);
    });
  });
  
  describe('Minimum Hold Period', () => {
    it('should NOT trigger exit during minimum hold period (60s)', () => {
      tracker.registerPosition('pos1', 'BTC-USD', 0.65);
      
      // Even with large decay, should not exit within 60s hold period
      tracker.updateConfidence('pos1', 0.80, 1.0);
      const result = tracker.updateConfidence('pos1', 0.50, 0.5); // Huge drop
      
      // Within 60s hold period, should NOT exit
      expect(result.shouldExit).toBe(false);
      expect(result.reason).toContain('hold period');
    });
  });
  
  describe('Proportional Decay Exit Logic (after hold period)', () => {
    it('should calculate exit threshold based on gap and decay ratio', () => {
      // Create tracker with 0s hold period to test decay logic directly
      const customTracker = new ConfidenceDecayTracker({
        minHoldSecondsForDecayExit: 0,
      } as any);
      customTracker.registerPosition('pos1', 'BTC-USD', 0.65);
      
      // Phase 44: Use pnlPercent=0.05 (flat, not profitable) to avoid Phase 40 profitable skip
      // Peak at 80%, gap = 15%, decay ratio = 70% (current config)
      // Exit threshold = 80% - (15% * 0.70) = 69.5%
      customTracker.updateConfidence('pos1', 0.80, 0.05);
      const result = customTracker.updateConfidence('pos1', 0.75, 0.05);
      
      expect(result.exitThreshold).toBeCloseTo(0.695, 1);
      expect(result.shouldExit).toBe(false); // 75% > 69.5%
    });
    
    it('should trigger exit when confidence drops below threshold', () => {
      const customTracker = new ConfidenceDecayTracker({
        minHoldSecondsForDecayExit: 0,
      } as any);
      customTracker.registerPosition('pos1', 'BTC-USD', 0.65);
      
      // Phase 44: Use pnlPercent=0.05 (flat) to avoid Phase 40 profitable skip (>0.1%)
      // Peak at 80%, exit threshold = 80% - (15% * 0.70) = 69.5%
      customTracker.updateConfidence('pos1', 0.80, 0.05);
      const result = customTracker.updateConfidence('pos1', 0.68, 0.05);
      
      expect(result.shouldExit).toBe(true);
      expect(result.reason).toContain('Confidence decay');
    });
    
    it('should not exit if confidence stays above threshold', () => {
      const customTracker = new ConfidenceDecayTracker({
        minHoldSecondsForDecayExit: 0,
      } as any);
      customTracker.registerPosition('pos1', 'BTC-USD', 0.65);
      
      // Phase 44: Use pnlPercent=0.05 (flat) to avoid Phase 40 profitable skip
      customTracker.updateConfidence('pos1', 0.80, 0.05);
      const result = customTracker.updateConfidence('pos1', 0.73, 0.05);
      
      expect(result.shouldExit).toBe(false);
    });
  });
  
  describe('Losing Position Deferral', () => {
    it('should defer losing positions (pnl < -0.3%) to hard exit rules', () => {
      const customTracker = new ConfidenceDecayTracker({
        minHoldSecondsForDecayExit: 0,
      } as any);
      customTracker.registerPosition('pos1', 'BTC-USD', 0.65);
      
      // Losing position with P&L < -0.3%
      customTracker.updateConfidence('pos1', 0.80, -1.0);
      const result = customTracker.updateConfidence('pos1', 0.68, -1.0);
      
      // Should NOT exit - too early for decay on new losing position
      expect(result.shouldExit).toBe(false);
      expect(result.reason).toContain('too early for decay');
    });
    
    it('should skip decay for profitable positions (Phase 40)', () => {
      const customTracker = new ConfidenceDecayTracker({
        minHoldSecondsForDecayExit: 0,
      } as any);
      customTracker.registerPosition('pos1', 'BTC-USD', 0.65);
      
      // Phase 40: Profitable positions (pnl > 0.1%) skip confidence decay entirely
      // Let profit targets and trailing stops handle profitable exits instead
      customTracker.updateConfidence('pos1', 0.80, 1.0);
      const result = customTracker.updateConfidence('pos1', 0.68, 1.0);
      
      // Phase 40: Should NOT exit — profitable positions bypass decay
      expect(result.shouldExit).toBe(false);
      expect(result.reason).toContain('Profitable position');
    });
    
    it('should apply decay for flat positions (pnl between -0.3% and 0.1%)', () => {
      const customTracker = new ConfidenceDecayTracker({
        minHoldSecondsForDecayExit: 0,
      } as any);
      customTracker.registerPosition('pos1', 'BTC-USD', 0.65);
      
      // Flat position (pnl = 0.05%, within decay range)
      customTracker.updateConfidence('pos1', 0.80, 0.05);
      const result = customTracker.updateConfidence('pos1', 0.68, 0.05);
      
      // With 70% decay: threshold = 80% - (15% * 0.70) = 69.5%
      // 68% < 69.5% should trigger exit
      expect(result.shouldExit).toBe(true);
    });
  });
  
  describe('Floor Protection', () => {
    it('should never set exit threshold below entry confidence', () => {
      const customTracker = new ConfidenceDecayTracker({
        minHoldSecondsForDecayExit: 0,
      } as any);
      customTracker.registerPosition('pos1', 'BTC-USD', 0.70);
      
      // Phase 44: Need gap >= 0.08 to pass Phase 40 minimum gap check
      // Peak at 80%, gap = 10% (>= 8% minimum), entry = 70%
      // Floor = entry + floorBuffer(0.00) = 70%
      customTracker.updateConfidence('pos1', 0.80, 0.05);
      const result = customTracker.updateConfidence('pos1', 0.71, 0.05);
      
      // exitThreshold = 80% - (10% * 0.70) = 73% — above entry, floor doesn't apply here
      // But the floor protection ensures it never goes below 70%
      expect(result.exitThreshold).toBeGreaterThanOrEqual(0.70);
    });
    
    it('should trigger exit when confidence drops to entry level', () => {
      const customTracker = new ConfidenceDecayTracker({
        minHoldSecondsForDecayExit: 0,
      } as any);
      customTracker.registerPosition('pos1', 'BTC-USD', 0.70);
      
      // Peak at 85%, then drop to below entry level
      customTracker.updateConfidence('pos1', 0.85, 1.5);
      const result = customTracker.updateConfidence('pos1', 0.68, 0.1);
      
      // Should exit because we're below entry level
      expect(result.shouldExit).toBe(true);
    });
  });
  
  describe('Urgency Levels', () => {
    it('should set low urgency for small decay', () => {
      tracker.registerPosition('pos1', 'BTC-USD', 0.65);
      
      tracker.updateConfidence('pos1', 0.80, 1.0);
      const result = tracker.updateConfidence('pos1', 0.78, 0.8);
      
      expect(result.urgency).toBe('low');
    });
    
    it('should set critical urgency for large decay with loss when past hold period', () => {
      const customTracker = new ConfidenceDecayTracker({
        minHoldSecondsForDecayExit: 0,
      } as any);
      customTracker.registerPosition('pos1', 'BTC-USD', 0.65);
      
      customTracker.updateConfidence('pos1', 0.85, 1.0);
      // Large decay + flat/small profit = should have urgency
      // Note: pnl must be > -0.3% to not be deferred
      const result = customTracker.updateConfidence('pos1', 0.66, -0.1);
      
      // With large decay, urgency should be high or critical
      expect(['high', 'critical']).toContain(result.urgency);
    });
  });
  
  describe('Performance', () => {
    it('should process updates in under 1ms', () => {
      tracker.registerPosition('pos1', 'BTC-USD', 0.70);
      
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        tracker.updateConfidence('pos1', 0.70 + Math.random() * 0.15, Math.random() * 2 - 1);
      }
      const duration = performance.now() - start;
      
      // Should process 1000 updates in under 100ms (0.1ms per update)
      expect(duration).toBeLessThan(100);
    });
    
    it('should handle many positions efficiently', () => {
      // Register 100 positions
      for (let i = 0; i < 100; i++) {
        tracker.registerPosition(`pos${i}`, 'BTC-USD', 0.65 + Math.random() * 0.15);
      }
      
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        tracker.updateConfidence(`pos${i}`, 0.70 + Math.random() * 0.10, Math.random() * 2 - 1);
      }
      const duration = performance.now() - start;
      
      // Should process 100 position updates in under 50ms
      expect(duration).toBeLessThan(50);
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle confidence at exactly entry level', () => {
      tracker.registerPosition('pos1', 'BTC-USD', 0.65);
      
      // At entry level with no peak above, should not exit (hold period)
      const result = tracker.updateConfidence('pos1', 0.65, 0);
      expect(result.peakConfidence).toBe(0.65);
    });
    
    it('should handle very small gaps', () => {
      const customTracker = new ConfidenceDecayTracker({
        minHoldSecondsForDecayExit: 0,
      } as any);
      customTracker.registerPosition('pos1', 'BTC-USD', 0.70);
      
      // Peak at 75%, gap = 5%
      customTracker.updateConfidence('pos1', 0.75, 0.5);
      const result = customTracker.updateConfidence('pos1', 0.74, 0.4);
      
      // Should not trigger exit when above threshold
      // Exit threshold = 75% - (5% * 0.70) = 71.5%
      // 74% > 71.5% so should not exit
      expect(result.shouldExit).toBe(false);
    });
    
    it('should handle confidence above 100% (clamped)', () => {
      tracker.registerPosition('pos1', 'BTC-USD', 0.95);
      
      // Confidence at 100%
      const result = tracker.updateConfidence('pos1', 1.0, 2.0);
      expect(result.peakConfidence).toBeLessThanOrEqual(1.0);
    });
    
    it('should defer negative P&L positions to hard exit rules', () => {
      const customTracker = new ConfidenceDecayTracker({
        minHoldSecondsForDecayExit: 0,
      } as any);
      customTracker.registerPosition('pos1', 'BTC-USD', 0.70);
      
      customTracker.updateConfidence('pos1', 0.80, -0.5);
      const result = customTracker.updateConfidence('pos1', 0.75, -1.0);
      
      // Losing positions (pnl < -0.3%) within 60s are too early for decay
      expect(result.shouldExit).toBe(false);
      expect(result.reason).toContain('too early for decay');
    });
  });
  
  describe('Statistics and Monitoring', () => {
    it('should provide position statistics', () => {
      tracker.registerPosition('pos1', 'BTC-USD', 0.70);
      
      tracker.updateConfidence('pos1', 0.80, 1.0);
      tracker.updateConfidence('pos1', 0.75, 0.5);
      
      const stats = tracker.getPositionStats('pos1');
      expect(stats).toBeDefined();
      expect(stats?.entryConfidence).toBe(0.70);
      expect(stats?.peakConfidence).toBe(0.80);
      expect(stats?.currentConfidence).toBe(0.75);
    });
    
    it('should return null for unknown position', () => {
      const stats = tracker.getPositionStats('unknown');
      expect(stats).toBeNull();
    });
  });
});
