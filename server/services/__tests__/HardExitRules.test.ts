import { describe, it, expect } from 'vitest';
import {
  evaluateHardExitRules,
  createHardExitPosition,
  calculateCombinedScore,
  HardExitPosition,
  HardExitConfig,
  DEFAULT_HARD_EXIT_CONFIG,
} from '../HardExitRules';

describe('HardExitRules', () => {
  const defaultConfig: HardExitConfig = DEFAULT_HARD_EXIT_CONFIG;

  describe('calculateCombinedScore', () => {
    it('should calculate combined score correctly', () => {
      // Combined Score = (Confidence × 0.6) + (ExecutionScore/100 × 0.4)
      expect(calculateCombinedScore(0.80, 50)).toBeCloseTo(0.68); // 0.80*0.6 + 0.5*0.4 = 0.48 + 0.20 = 0.68
      expect(calculateCombinedScore(0.70, 60)).toBeCloseTo(0.66); // 0.70*0.6 + 0.6*0.4 = 0.42 + 0.24 = 0.66
      expect(calculateCombinedScore(1.0, 100)).toBeCloseTo(1.0);  // 1.0*0.6 + 1.0*0.4 = 1.0
      expect(calculateCombinedScore(0.5, 0)).toBeCloseTo(0.30);   // 0.5*0.6 + 0*0.4 = 0.30
    });
  });

  describe('createHardExitPosition', () => {
    it('should create position with correct initial values', () => {
      const position = createHardExitPosition(
        'pos-123',
        'BTC-USD',
        'long',
        100000,
        0.1,
        0.75,
        'bullish'
      );

      expect(position.id).toBe('pos-123');
      expect(position.symbol).toBe('BTC-USD');
      expect(position.side).toBe('long');
      expect(position.entryPrice).toBe(100000);
      expect(position.quantity).toBe(0.1);
      expect(position.entryCombinedScore).toBe(0.75);
      expect(position.peakCombinedScore).toBe(0.75);
      expect(position.currentCombinedScore).toBe(0.75);
      expect(position.entryDirection).toBe('bullish');
      expect(position.currentDirection).toBe('bullish');
      expect(position.unrealizedPnlPercent).toBe(0);
    });
  });

  describe('Rule 1: Consensus Direction FLIPS', () => {
    it('should trigger exit when direction flips from bullish to bearish', () => {
      const position: HardExitPosition = {
        id: 'pos-1',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 100000,
        currentPrice: 100500,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnlPercent: 0.5,
        entryTime: Date.now() - 1000 * 60 * 30, // 30 minutes ago
        entryDirection: 'bullish',
        entryCombinedScore: 0.75,
        peakCombinedScore: 0.80,
        peakCombinedScoreTime: Date.now() - 1000 * 60 * 10,
        currentCombinedScore: 0.70,
        currentDirection: 'bearish', // FLIPPED!
      };

      const decision = evaluateHardExitRules(position, defaultConfig);

      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('DIRECTION_FLIP');
      expect(decision.urgency).toBe('critical');
      expect(decision.reason).toContain('CONSENSUS FLIP');
    });

    it('should trigger exit when direction flips from bearish to bullish', () => {
      const position: HardExitPosition = {
        id: 'pos-2',
        symbol: 'ETH-USD',
        side: 'short',
        entryPrice: 3000,
        currentPrice: 2950,
        quantity: 1,
        remainingQuantity: 1,
        unrealizedPnlPercent: 1.67,
        entryTime: Date.now() - 1000 * 60 * 60, // 1 hour ago
        entryDirection: 'bearish',
        entryCombinedScore: 0.72,
        peakCombinedScore: 0.78,
        peakCombinedScoreTime: Date.now() - 1000 * 60 * 20,
        currentCombinedScore: 0.65,
        currentDirection: 'bullish', // FLIPPED!
      };

      const decision = evaluateHardExitRules(position, defaultConfig);

      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('DIRECTION_FLIP');
    });

    it('should NOT trigger exit when direction is same as entry', () => {
      const position: HardExitPosition = {
        id: 'pos-3',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 100000,
        currentPrice: 101000,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnlPercent: 1.0,
        entryTime: Date.now() - 1000 * 60 * 30,
        entryDirection: 'bullish',
        entryCombinedScore: 0.75,
        peakCombinedScore: 0.80,
        peakCombinedScoreTime: Date.now() - 1000 * 60 * 5,
        currentCombinedScore: 0.78,
        currentDirection: 'bullish', // Same direction
      };

      const decision = evaluateHardExitRules(position, defaultConfig);

      expect(decision.shouldExit).toBe(false);
      expect(decision.rule).toBe('HOLD');
    });
  });

  describe('Rule 2: Combined Score Decay (40%)', () => {
    it('should trigger exit when combined score drops 40% from peak', () => {
      const position: HardExitPosition = {
        id: 'pos-4',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 100000,
        currentPrice: 100200,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnlPercent: 0.2,
        entryTime: Date.now() - 1000 * 60 * 60,
        entryDirection: 'bullish',
        entryCombinedScore: 0.70,
        peakCombinedScore: 0.80, // Peak was 80%
        peakCombinedScoreTime: Date.now() - 1000 * 60 * 30,
        currentCombinedScore: 0.30, // Current is 30% - below 80% * (1 - 0.60) = 32%
        currentDirection: 'bullish',
      };

      const decision = evaluateHardExitRules(position, defaultConfig);

      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('COMBINED_SCORE_DECAY');
      expect(decision.urgency).toBe('high');
    });

    it('should NOT trigger exit when combined score is above threshold', () => {
      const position: HardExitPosition = {
        id: 'pos-5',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 100000,
        currentPrice: 100500,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnlPercent: 0.5,
        entryTime: Date.now() - 1000 * 60 * 60,
        entryDirection: 'bullish',
        entryCombinedScore: 0.70,
        peakCombinedScore: 0.80, // Peak was 80%
        peakCombinedScoreTime: Date.now() - 1000 * 60 * 10,
        currentCombinedScore: 0.35, // Current is 35% - above 80% * (1 - 0.60) = 32%
        currentDirection: 'bullish',
      };

      const decision = evaluateHardExitRules(position, defaultConfig);

      expect(decision.shouldExit).toBe(false);
      expect(decision.rule).toBe('HOLD');
    });
  });

  describe('Rule 3: Capital Rotation', () => {
    it('should trigger exit when position is old AND no new peak', () => {
      const now = Date.now();
      const position: HardExitPosition = {
        id: 'pos-6',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 100000,
        currentPrice: 100100,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnlPercent: 0.1,
        entryTime: now - 1000 * 60 * 60 * 5, // 5 hours ago (> 4.5h threshold)
        entryDirection: 'bullish',
        entryCombinedScore: 0.70,
        peakCombinedScore: 0.75,
        peakCombinedScoreTime: now - 1000 * 60 * 90, // 90 minutes since last peak (> 60 min threshold)
        currentCombinedScore: 0.65, // Above decay threshold
        currentDirection: 'bullish',
      };

      const decision = evaluateHardExitRules(position, defaultConfig);

      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('CAPITAL_ROTATION');
      expect(decision.urgency).toBe('medium');
    });

    it('should NOT trigger capital rotation if position is young', () => {
      const now = Date.now();
      const position: HardExitPosition = {
        id: 'pos-7',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 100000,
        currentPrice: 100100,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnlPercent: 0.1,
        entryTime: now - 1000 * 60 * 60 * 2, // 2 hours ago (< 4.5h threshold)
        entryDirection: 'bullish',
        entryCombinedScore: 0.70,
        peakCombinedScore: 0.75,
        peakCombinedScoreTime: now - 1000 * 60 * 90, // 90 minutes since last peak
        currentCombinedScore: 0.65,
        currentDirection: 'bullish',
      };

      const decision = evaluateHardExitRules(position, defaultConfig);

      expect(decision.shouldExit).toBe(false);
      expect(decision.rule).toBe('HOLD');
    });

    it('should NOT trigger capital rotation if recent peak exists', () => {
      const now = Date.now();
      const position: HardExitPosition = {
        id: 'pos-8',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 100000,
        currentPrice: 100100,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnlPercent: 0.1,
        entryTime: now - 1000 * 60 * 60 * 5, // 5 hours ago (> 4.5h threshold)
        entryDirection: 'bullish',
        entryCombinedScore: 0.70,
        peakCombinedScore: 0.75,
        peakCombinedScoreTime: now - 1000 * 60 * 30, // 30 minutes since last peak (< 60 min threshold)
        currentCombinedScore: 0.65,
        currentDirection: 'bullish',
      };

      const decision = evaluateHardExitRules(position, defaultConfig);

      expect(decision.shouldExit).toBe(false);
      expect(decision.rule).toBe('HOLD');
    });
  });

  describe('Rule 4: Emergency Loss', () => {
    it('should trigger emergency exit at -4.5% loss', () => {
      const position: HardExitPosition = {
        id: 'pos-9',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 100000,
        currentPrice: 95400, // -4.6% loss
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnlPercent: -4.6,
        entryTime: Date.now() - 1000 * 60 * 30,
        entryDirection: 'bullish',
        entryCombinedScore: 0.75,
        peakCombinedScore: 0.78,
        peakCombinedScoreTime: Date.now() - 1000 * 60 * 20,
        currentCombinedScore: 0.60, // Still above decay threshold
        currentDirection: 'bullish', // Direction hasn't flipped
      };

      const decision = evaluateHardExitRules(position, defaultConfig);

      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('EMERGENCY_LOSS');
      expect(decision.urgency).toBe('critical');
    });

    it('should NOT trigger emergency exit above -4.5%', () => {
      const position: HardExitPosition = {
        id: 'pos-10',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 100000,
        currentPrice: 96000, // -4.0% loss
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnlPercent: -4.0,
        entryTime: Date.now() - 1000 * 60 * 30,
        entryDirection: 'bullish',
        entryCombinedScore: 0.75,
        peakCombinedScore: 0.78,
        peakCombinedScoreTime: Date.now() - 1000 * 60 * 10,
        currentCombinedScore: 0.60,
        currentDirection: 'bullish',
      };

      const decision = evaluateHardExitRules(position, defaultConfig);

      expect(decision.shouldExit).toBe(false);
      expect(decision.rule).toBe('HOLD');
    });
  });

  describe('Rule Priority', () => {
    it('should prioritize direction flip over other rules', () => {
      const now = Date.now();
      const position: HardExitPosition = {
        id: 'pos-11',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 100000,
        currentPrice: 95000, // -5% loss (would trigger emergency)
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnlPercent: -5.0,
        entryTime: now - 1000 * 60 * 60 * 5, // Old position (would trigger capital rotation)
        entryDirection: 'bullish',
        entryCombinedScore: 0.70,
        peakCombinedScore: 0.80,
        peakCombinedScoreTime: now - 1000 * 60 * 90, // No recent peak
        currentCombinedScore: 0.40, // Below decay threshold
        currentDirection: 'bearish', // FLIPPED - highest priority
      };

      const decision = evaluateHardExitRules(position, defaultConfig);

      // Direction flip should be triggered first (highest priority)
      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('DIRECTION_FLIP');
    });

    it('should prioritize combined score decay over capital rotation', () => {
      const now = Date.now();
      const position: HardExitPosition = {
        id: 'pos-12',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 100000,
        currentPrice: 100100,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnlPercent: 0.1,
        entryTime: now - 1000 * 60 * 60 * 5, // Old position
        entryDirection: 'bullish',
        entryCombinedScore: 0.70,
        peakCombinedScore: 0.80,
        peakCombinedScoreTime: now - 1000 * 60 * 90, // No recent peak
        currentCombinedScore: 0.30, // Below decay threshold (80% * (1-0.60) = 32%)
        currentDirection: 'bullish', // No flip
      };

      const decision = evaluateHardExitRules(position, defaultConfig);

      // Combined score decay should be triggered (higher priority than capital rotation)
      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('COMBINED_SCORE_DECAY');
    });
  });

  describe('Metrics', () => {
    it('should return correct metrics in decision', () => {
      const now = Date.now();
      const entryTime = now - 1000 * 60 * 60 * 2; // 2 hours ago
      const peakTime = now - 1000 * 60 * 30; // 30 minutes ago
      
      const position: HardExitPosition = {
        id: 'pos-13',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 100000,
        currentPrice: 100500,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnlPercent: 0.5,
        entryTime,
        entryDirection: 'bullish',
        entryCombinedScore: 0.70,
        peakCombinedScore: 0.80,
        peakCombinedScoreTime: peakTime,
        currentCombinedScore: 0.75,
        currentDirection: 'bullish',
      };

      const decision = evaluateHardExitRules(position, defaultConfig);

      expect(decision.metrics.currentDirection).toBe('bullish');
      expect(decision.metrics.entryDirection).toBe('bullish');
      expect(decision.metrics.currentCombinedScore).toBe(0.75);
      expect(decision.metrics.peakCombinedScore).toBe(0.80);
      expect(decision.metrics.exitThreshold).toBeCloseTo(0.32); // 80% * (1 - 0.60)
      expect(decision.metrics.positionAgeHours).toBeCloseTo(2, 0);
      expect(decision.metrics.timeSinceLastPeakMinutes).toBeCloseTo(30, 0);
      expect(decision.metrics.unrealizedPnlPercent).toBe(0.5);
    });
  });
});
