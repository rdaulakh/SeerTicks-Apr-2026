import { describe, it, expect } from 'vitest';
import { 
  evaluatePriorityExitRules, 
  PriorityExitPosition,
  DEFAULT_PRIORITY_EXIT_CONFIG 
} from '../services/PriorityExitManager';

describe('PriorityExitManager', () => {
  const basePosition: PriorityExitPosition = {
    id: 'test-position-1',
    symbol: 'BTC-USD',
    side: 'long',
    entryPrice: 50000,
    currentPrice: 50000,
    quantity: 1,
    remainingQuantity: 1,
    unrealizedPnlPercent: 0,
    entryTime: Date.now() - 60000, // 1 minute ago
    entryDirection: 'bullish',
    entryCombinedScore: 0.7,
    peakCombinedScore: 0.7,
    peakCombinedScoreTime: Date.now() - 60000,
    currentCombinedScore: 0.7,
    currentDirection: 'bullish',
    peakPnlPercent: 0,
    targetsHit: {},
  };

  describe('Priority 1: Hard Stop-Loss', () => {
    // Phase 44: stop-loss tightened to -0.8% (Phase 40, was -1.0%)
    it('should trigger stop-loss at -1.5% loss (well below -0.8% threshold)', () => {
      const position = {
        ...basePosition,
        currentPrice: 49250, // -1.5%
        unrealizedPnlPercent: -1.5,
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('HARD_STOP_LOSS');
      expect(decision.exitType).toBe('full');
      expect(decision.urgency).toBe('critical');
    });

    // Phase 15C: -1.0% now exactly hits the stop-loss (hardStopLossPercent: -1.0)
    it('should trigger stop-loss at exactly -1.0% loss (Phase 15C threshold)', () => {
      const position = {
        ...basePosition,
        currentPrice: 49500, // -1.0%
        unrealizedPnlPercent: -1.0,
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      // Phase 15C: -1.0% is exactly at the threshold, so it should trigger
      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('HARD_STOP_LOSS');
    });

    it('should trigger stop-loss at exactly -0.8% loss (Phase 40 threshold)', () => {
      const position = {
        ...basePosition,
        currentPrice: 49600, // -0.8%
        unrealizedPnlPercent: -0.8,
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      // Phase 44: -0.8% is exactly at the threshold, so it should trigger
      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('HARD_STOP_LOSS');
    });

    it('should NOT trigger stop-loss at -0.5% loss', () => {
      const position = {
        ...basePosition,
        currentPrice: 49750, // -0.5%
        unrealizedPnlPercent: -0.5,
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      // Should not exit for stop-loss at -0.5% (above -0.8% threshold)
      if (decision.shouldExit) {
        expect(decision.rule).not.toBe('HARD_STOP_LOSS');
      }
    });
  });

  describe('Priority 3: Profit Targets (BEFORE confidence decay)', () => {
    it('should trigger partial exit at +0.5% profit (target 1)', () => {
      const position = {
        ...basePosition,
        currentPrice: 50250, // +0.5%
        unrealizedPnlPercent: 0.5,
        targetsHit: {}, // No targets hit yet
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('PROFIT_TARGET_0.5');
      expect(decision.exitType).toBe('partial');
      expect(decision.partialPercent).toBe(33);
    });

    it('should NOT re-trigger target 1 if already hit', () => {
      const position = {
        ...basePosition,
        currentPrice: 50250, // +0.5%
        unrealizedPnlPercent: 0.5,
        targetsHit: { target1: true }, // Already hit
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      // Should not exit for target 1 again
      if (decision.shouldExit) {
        expect(decision.rule).not.toBe('PROFIT_TARGET_0.5');
      }
    });

    it('should trigger partial exit at +1.5% profit (target 2)', () => {
      const position = {
        ...basePosition,
        currentPrice: 50750, // +1.5%
        unrealizedPnlPercent: 1.5,
        targetsHit: { target1: true }, // Target 1 already hit
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('PROFIT_TARGET_1.5');
      expect(decision.exitType).toBe('partial');
      expect(decision.partialPercent).toBe(33);
    });

    it('should trigger full exit at +3.0% profit (target 3)', () => {
      const position = {
        ...basePosition,
        currentPrice: 51500, // +3.0%
        unrealizedPnlPercent: 3.0,
        targetsHit: { target1: true, target2: true }, // Targets 1 & 2 already hit
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('PROFIT_TARGET_3.0');
      expect(decision.exitType).toBe('full');
    });
  });

  describe('Priority 2: Max Loser Time (15 min - Phase 15C)', () => {
    // Phase 15C: maxLoserTimeMinutes reduced to 15 (was 30)
    // Note: MAX_LOSER_TIME is a fallback when ATR is unavailable
    it('should cut losing position after 15 minutes (no ATR)', () => {
      const position = {
        ...basePosition,
        entryTime: Date.now() - (16 * 60 * 1000), // 16 minutes ago
        unrealizedPnlPercent: -0.5, // Losing
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('MAX_LOSER_TIME');
    });

    it('should NOT cut winning position after 15 minutes', () => {
      const position = {
        ...basePosition,
        entryTime: Date.now() - (16 * 60 * 1000), // 16 minutes ago
        unrealizedPnlPercent: 0.3, // Winning
        currentPrice: 50150,
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      // Should not exit for max loser time if winning
      if (decision.shouldExit) {
        expect(decision.rule).not.toBe('MAX_LOSER_TIME');
      }
    });
  });

  describe('Priority 5: Max Winner Time (2 hours - Phase 15C)', () => {
    // Phase 15C: maxWinnerTimeMinutes reduced to 120 (was 180)
    it('should take profits after 2 hours if winning', () => {
      const position = {
        ...basePosition,
        entryTime: Date.now() - (121 * 60 * 1000), // 2 hours 1 minute ago
        unrealizedPnlPercent: 0.8, // Winning
        currentPrice: 50400,
        targetsHit: { target1: true }, // Some targets hit
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('MAX_WINNER_TIME');
    });
  });

  describe('Priority 6: Direction Flip', () => {
    it('should exit when direction flips against position (past protection)', () => {
      const position = {
        ...basePosition,
        side: 'long',
        entryDirection: 'bullish',
        currentDirection: 'bearish', // Flipped!
        // Phase 15C: minHoldTimeForDecayMinutes is 20 (was 15)
        entryTime: Date.now() - (11 * 60 * 1000), // 11 minutes (past 10 min protection)
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('DIRECTION_FLIP');
    });

    it('should NOT exit on direction flip within 10 min protection (Phase 15C)', () => {
      const position = {
        ...basePosition,
        side: 'long',
        entryDirection: 'bullish',
        currentDirection: 'bearish', // Flipped!
        // Phase 15C: minHoldTimeForDecayMinutes is 20 (was 15)
        entryTime: Date.now() - (5 * 60 * 1000), // Only 5 minutes (within protection)
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      // Should not exit due to direction flip within protection period
      if (decision.shouldExit) {
        expect(decision.rule).not.toBe('DIRECTION_FLIP');
      }
    });
  });

  describe('Priority 7: Confidence Decay (Strict Conditions)', () => {
    it('should only trigger confidence decay when ALL conditions met', () => {
      const position = {
        ...basePosition,
        // Phase 15C: minHoldTimeForDecayMinutes is 20 (was 15)
        entryTime: Date.now() - (11 * 60 * 1000), // 11 minutes (past 10 min protection)
        unrealizedPnlPercent: -0.5, // Losing
        currentCombinedScore: 0.25, // Below 30%
        currentDirection: 'neutral', // Neutral direction (not flipped against position)
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('CONFIDENCE_DECAY_EXTREME');
    });

    it('should NOT trigger confidence decay if winning (even with low score)', () => {
      const position = {
        ...basePosition,
        entryTime: Date.now() - (11 * 60 * 1000), // 11 minutes
        unrealizedPnlPercent: 0.3, // Winning!
        currentPrice: 50150,
        currentCombinedScore: 0.25, // Low score
        currentDirection: 'bearish', // Against position
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      // Should not exit for confidence decay if winning
      if (decision.shouldExit) {
        expect(decision.rule).not.toBe('CONFIDENCE_DECAY_EXTREME');
      }
    });

    it('should NOT trigger confidence decay if score above 30%', () => {
      const position = {
        ...basePosition,
        entryTime: Date.now() - (11 * 60 * 1000), // 11 minutes
        unrealizedPnlPercent: -0.5, // Losing
        currentCombinedScore: 0.35, // Above 30%
        currentDirection: 'bearish', // Against position
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      // Should not exit for confidence decay if score above threshold
      if (decision.shouldExit) {
        expect(decision.rule).not.toBe('CONFIDENCE_DECAY_EXTREME');
      }
    });
  });

  describe('Exit Priority Order', () => {
    it('should prioritize stop-loss over profit targets', () => {
      const position = {
        ...basePosition,
        unrealizedPnlPercent: -1.5, // Stop-loss level
        currentPrice: 49250,
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      expect(decision.shouldExit).toBe(true);
      expect(decision.rule).toBe('HARD_STOP_LOSS');
    });

    it('should prioritize profit targets over confidence decay', () => {
      const position = {
        ...basePosition,
        unrealizedPnlPercent: 0.5, // Profit target 1
        currentPrice: 50250,
        currentCombinedScore: 0.25, // Would trigger confidence decay
        currentDirection: 'bearish',
        entryTime: Date.now() - (11 * 60 * 1000), // Past protection
        targetsHit: {}, // No targets hit
      };
      
      const decision = evaluatePriorityExitRules(position, DEFAULT_PRIORITY_EXIT_CONFIG);
      
      expect(decision.shouldExit).toBe(true);
      // Should be profit target, NOT confidence decay
      expect(decision.rule).toBe('PROFIT_TARGET_0.5');
    });
  });
});
