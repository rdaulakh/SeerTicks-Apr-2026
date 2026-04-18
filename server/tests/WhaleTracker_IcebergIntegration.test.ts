/**
 * WhaleTracker Iceberg Integration Tests
 * 
 * Tests the integration of IcebergOrderDetector with WhaleTracker agent
 * to ensure iceberg detection enhances whale signal accuracy.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WhaleTracker } from '../agents/WhaleTracker';

// Mock the external services
vi.mock('../services/whaleAlertService', () => ({
  fetchWhaleAlerts: vi.fn().mockResolvedValue({ transactions: [] }),
}));

vi.mock('../services/MultiSourceWhaleService', () => ({
  getAggregatedWhaleData: vi.fn().mockResolvedValue({
    sourceCount: 1,
    sources: [{ source: 'mock' }],
    aggregatedInflow: 1000000,
    aggregatedOutflow: 500000,
    aggregatedNetFlow: 500000,
    totalLargeTransactions: 5,
    signalStrength: 0.6,
    overallConfidence: 0.65,
  }),
  getWhaleSignalFromAggregated: vi.fn().mockReturnValue({
    signal: 'bullish',
    confidence: 0.65,
    reasoning: 'Net outflow indicates accumulation',
    executionScore: 60,
  }),
}));

describe('WhaleTracker Iceberg Integration', () => {
  let whaleTracker: WhaleTracker;

  beforeEach(() => {
    whaleTracker = new WhaleTracker();
  });

  describe('Iceberg Detection in Analyze', () => {
    it('should detect iceberg pattern from repeated same-size trades', async () => {
      const now = Date.now();
      const context = {
        recentTrades: [
          { price: 50000, size: 1.5, side: 'buy', timestamp: now - 5000 },
          { price: 50001, size: 1.5, side: 'buy', timestamp: now - 4000 },
          { price: 50002, size: 1.5, side: 'buy', timestamp: now - 3000 },
          { price: 50003, size: 1.5, side: 'buy', timestamp: now - 2000 },
          { price: 50004, size: 1.5, side: 'buy', timestamp: now - 1000 },
        ],
        currentPrice: 50000,
      };

      const signal = await whaleTracker.generateSignal('BTC-USD', context);
      
      expect(signal).toBeDefined();
      expect(signal.evidence).toBeDefined();
      expect(signal.evidence.icebergDetected).toBe(true);
      expect(signal.evidence.icebergDirection).toBe('buy');
      expect(signal.evidence.icebergChunks).toBeGreaterThanOrEqual(4);
    });

    it('should boost confidence when iceberg aligns with whale signal', async () => {
      const now = Date.now();
      const context = {
        recentTrades: [
          { price: 50000, size: 2.0, side: 'buy', timestamp: now - 5000 },
          { price: 50001, size: 2.0, side: 'buy', timestamp: now - 4000 },
          { price: 50002, size: 2.0, side: 'buy', timestamp: now - 3000 },
          { price: 50003, size: 2.0, side: 'buy', timestamp: now - 2000 },
          { price: 50004, size: 2.0, side: 'buy', timestamp: now - 1000 },
        ],
        currentPrice: 50000,
      };

      const signal = await whaleTracker.generateSignal('BTC-USD', context);
      
      // Whale signal is bullish, iceberg is buy (bullish) - should boost confidence
      expect(signal.signal).toBe('bullish');
      expect(signal.confidence).toBeGreaterThan(0.65); // Original was 0.65
      expect(signal.reasoning).toContain('ICEBERG');
    });

    it('should not detect iceberg from random trades', async () => {
      const now = Date.now();
      const context = {
        recentTrades: [
          { price: 50000, size: 0.5, side: 'buy', timestamp: now - 5000 },
          { price: 50100, size: 2.3, side: 'sell', timestamp: now - 4000 },
          { price: 49900, size: 0.1, side: 'buy', timestamp: now - 3000 },
        ],
        currentPrice: 50000,
      };

      const signal = await whaleTracker.generateSignal('BTC-USD', context);
      
      expect(signal.evidence.icebergDetected).toBe(false);
    });

    it('should detect sell-side iceberg', async () => {
      const now = Date.now();
      const context = {
        recentTrades: [
          { price: 50000, size: 3.0, side: 'sell', timestamp: now - 5000 },
          { price: 49999, size: 3.0, side: 'sell', timestamp: now - 4000 },
          { price: 49998, size: 3.0, side: 'sell', timestamp: now - 3000 },
          { price: 49997, size: 3.0, side: 'sell', timestamp: now - 2000 },
          { price: 49996, size: 3.0, side: 'sell', timestamp: now - 1000 },
        ],
        currentPrice: 50000,
      };

      const signal = await whaleTracker.generateSignal('BTC-USD', context);
      
      expect(signal.evidence.icebergDetected).toBe(true);
      expect(signal.evidence.icebergDirection).toBe('sell');
    });
  });

  describe('Iceberg Public API', () => {
    it('should return null for symbol with no iceberg', () => {
      const signal = whaleTracker.getLastIcebergSignal('UNKNOWN-USD');
      expect(signal).toBeNull();
    });

    it('should track iceberg signals after detection', async () => {
      const now = Date.now();
      const context = {
        recentTrades: [
          { price: 50000, size: 1.5, side: 'buy', timestamp: now - 5000 },
          { price: 50001, size: 1.5, side: 'buy', timestamp: now - 4000 },
          { price: 50002, size: 1.5, side: 'buy', timestamp: now - 3000 },
          { price: 50003, size: 1.5, side: 'buy', timestamp: now - 2000 },
          { price: 50004, size: 1.5, side: 'buy', timestamp: now - 1000 },
        ],
        currentPrice: 50000,
      };

      await whaleTracker.generateSignal('BTC-USD', context);
      
      const icebergSignal = whaleTracker.getLastIcebergSignal('BTC-USD');
      expect(icebergSignal).not.toBeNull();
      expect(icebergSignal?.direction).toBe('bullish');
    });

    it('should report active iceberg correctly', async () => {
      const now = Date.now();
      const context = {
        recentTrades: [
          { price: 50000, size: 1.5, side: 'buy', timestamp: now - 5000 },
          { price: 50001, size: 1.5, side: 'buy', timestamp: now - 4000 },
          { price: 50002, size: 1.5, side: 'buy', timestamp: now - 3000 },
          { price: 50003, size: 1.5, side: 'buy', timestamp: now - 2000 },
          { price: 50004, size: 1.5, side: 'buy', timestamp: now - 1000 },
        ],
        currentPrice: 50000,
      };

      await whaleTracker.generateSignal('BTC-USD', context);
      
      expect(whaleTracker.hasActiveIceberg('BTC-USD')).toBe(true);
      expect(whaleTracker.hasActiveIceberg('UNKNOWN-USD')).toBe(false);
    });

    it('should provide iceberg summary', async () => {
      const now = Date.now();
      
      // Detect iceberg for BTC
      await whaleTracker.generateSignal('BTC-USD', {
        recentTrades: [
          { price: 50000, size: 1.5, side: 'buy', timestamp: now - 5000 },
          { price: 50001, size: 1.5, side: 'buy', timestamp: now - 4000 },
          { price: 50002, size: 1.5, side: 'buy', timestamp: now - 3000 },
          { price: 50003, size: 1.5, side: 'buy', timestamp: now - 2000 },
          { price: 50004, size: 1.5, side: 'buy', timestamp: now - 1000 },
        ],
        currentPrice: 50000,
      });

      const summary = whaleTracker.getIcebergSummary();
      expect(summary.length).toBeGreaterThan(0);
      expect(summary[0].symbol).toBe('BTC-USD');
      expect(summary[0].direction).toBe('bullish');
    });

    it('should clear iceberg cache', async () => {
      const now = Date.now();
      
      await whaleTracker.generateSignal('BTC-USD', {
        recentTrades: [
          { price: 50000, size: 1.5, side: 'buy', timestamp: now - 5000 },
          { price: 50001, size: 1.5, side: 'buy', timestamp: now - 4000 },
          { price: 50002, size: 1.5, side: 'buy', timestamp: now - 3000 },
          { price: 50003, size: 1.5, side: 'buy', timestamp: now - 2000 },
          { price: 50004, size: 1.5, side: 'buy', timestamp: now - 1000 },
        ],
        currentPrice: 50000,
      });

      expect(whaleTracker.hasActiveIceberg('BTC-USD')).toBe(true);
      
      whaleTracker.clearIcebergCache();
      
      expect(whaleTracker.hasActiveIceberg('BTC-USD')).toBe(false);
      expect(whaleTracker.getIcebergSummary().length).toBe(0);
    });
  });

  describe('Signal Combination Logic', () => {
    it('should include iceberg evidence in signal output', async () => {
      const now = Date.now();
      const context = {
        recentTrades: [
          { price: 50000, size: 1.5, side: 'buy', timestamp: now - 5000 },
          { price: 50001, size: 1.5, side: 'buy', timestamp: now - 4000 },
          { price: 50002, size: 1.5, side: 'buy', timestamp: now - 3000 },
          { price: 50003, size: 1.5, side: 'buy', timestamp: now - 2000 },
          { price: 50004, size: 1.5, side: 'buy', timestamp: now - 1000 },
        ],
        currentPrice: 50000,
      };

      const signal = await whaleTracker.generateSignal('BTC-USD', context);
      
      expect(signal.evidence).toHaveProperty('icebergDetected');
      expect(signal.evidence).toHaveProperty('icebergDirection');
      expect(signal.evidence).toHaveProperty('icebergConfidence');
      expect(signal.evidence).toHaveProperty('icebergChunks');
      expect(signal.evidence).toHaveProperty('icebergEstimatedSize');
    });

    it('should boost quality score when iceberg detected', async () => {
      const now = Date.now();
      const context = {
        recentTrades: [
          { price: 50000, size: 1.5, side: 'buy', timestamp: now - 5000 },
          { price: 50001, size: 1.5, side: 'buy', timestamp: now - 4000 },
          { price: 50002, size: 1.5, side: 'buy', timestamp: now - 3000 },
          { price: 50003, size: 1.5, side: 'buy', timestamp: now - 2000 },
          { price: 50004, size: 1.5, side: 'buy', timestamp: now - 1000 },
        ],
        currentPrice: 50000,
      };

      const signal = await whaleTracker.generateSignal('BTC-USD', context);
      
      // Quality score should be boosted when iceberg detected
      expect(signal.qualityScore).toBeGreaterThan(0.65); // Original was 0.65
    });

    it('should boost execution score when iceberg detected', async () => {
      const now = Date.now();
      const context = {
        recentTrades: [
          { price: 50000, size: 1.5, side: 'buy', timestamp: now - 5000 },
          { price: 50001, size: 1.5, side: 'buy', timestamp: now - 4000 },
          { price: 50002, size: 1.5, side: 'buy', timestamp: now - 3000 },
          { price: 50003, size: 1.5, side: 'buy', timestamp: now - 2000 },
          { price: 50004, size: 1.5, side: 'buy', timestamp: now - 1000 },
        ],
        currentPrice: 50000,
      };

      const signal = await whaleTracker.generateSignal('BTC-USD', context);
      
      // Execution score should be boosted when iceberg detected
      expect(signal.executionScore).toBeGreaterThan(60); // Original was 60
    });
  });
});
