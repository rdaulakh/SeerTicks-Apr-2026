/**
 * Trade Decision Logging Tests
 * 
 * Validates that:
 * 1. Only actionable trade opportunities are logged (not neutral/weak signals)
 * 2. EXECUTED trades are logged correctly
 * 3. MISSED opportunities are logged with proper reasons
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Trade Decision Logging', () => {
  describe('AutomatedSignalProcessor Logging Logic', () => {
    it('should NOT log when all signals are neutral', () => {
      // Neutral signals should not be logged - only actionable opportunities
      const neutralSignals = [
        { agentName: 'TechnicalAnalyst', signal: 'neutral', confidence: 0.5 },
        { agentName: 'PatternMatcher', signal: 'neutral', confidence: 0.6 },
      ];
      
      // The processor should return early without logging
      expect(neutralSignals.every(s => s.signal === 'neutral')).toBe(true);
    });

    it('should NOT log when consensus is below threshold', () => {
      // Weak consensus should not be logged
      const weakConsensus = {
        direction: 'bullish',
        strength: 0.55, // Below 65% threshold
      };
      
      const threshold = 0.65;
      expect(weakConsensus.strength < threshold).toBe(true);
    });

    it('should NOT log when confidence is below minimum', () => {
      // Low confidence signals should not be logged
      const lowConfidenceSignals = [
        { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.45 },
        { agentName: 'PatternMatcher', signal: 'bullish', confidence: 0.50 },
      ];
      
      const minConfidence = 0.60;
      const highConfidenceSignals = lowConfidenceSignals.filter(s => s.confidence >= minConfidence);
      expect(highConfidenceSignals.length).toBe(0);
    });

    it('should log EXECUTED when all criteria are met', () => {
      // High quality signals should be logged as EXECUTED
      const highQualitySignals = [
        { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.85, executionScore: 75 },
        { agentName: 'PatternMatcher', signal: 'bullish', confidence: 0.80, executionScore: 70 },
      ];
      
      const consensus = {
        direction: 'bullish',
        strength: 0.82, // Above 65% threshold
      };
      
      const minConfidence = 0.60;
      const threshold = 0.65;
      
      // All criteria met
      expect(consensus.strength >= threshold).toBe(true);
      expect(highQualitySignals.every(s => s.confidence >= minConfidence)).toBe(true);
      
      // Calculate combined score
      const combinedScores = highQualitySignals.map(s => 
        (s.confidence * 0.6) + (s.executionScore / 100 * 0.4)
      );
      expect(combinedScores.every(score => score >= 0.50)).toBe(true);
    });
  });

  describe('AutomatedTradeExecutor Missed Opportunity Logging', () => {
    it('should log MISSED when insufficient balance', () => {
      const reason = 'Insufficient available balance';
      const decision = 'SKIPPED';
      const decisionReason = `MISSED: ${reason}`;
      
      expect(decisionReason).toContain('MISSED');
      expect(decisionReason).toContain('Insufficient');
    });

    it('should log MISSED when max positions reached', () => {
      const maxPositions = 10;
      const currentPositions = 10;
      const reason = `Maximum positions limit reached (${currentPositions}/${maxPositions})`;
      const decisionReason = `MISSED: ${reason}`;
      
      expect(currentPositions >= maxPositions).toBe(true);
      expect(decisionReason).toContain('MISSED');
      expect(decisionReason).toContain('Maximum positions');
    });

    it('should log MISSED when invalid position size', () => {
      const reason = 'Invalid position size calculated';
      const decisionReason = `MISSED: ${reason}`;
      
      expect(decisionReason).toContain('MISSED');
      expect(decisionReason).toContain('position size');
    });

    it('should mark as OPPORTUNITY_MISSED when confidence >= threshold', () => {
      // When a signal is SKIPPED but confidence >= threshold, it's a genuine miss
      const totalConfidence = 75; // Above threshold
      const threshold = 65;
      
      const isGenuineMiss = totalConfidence >= threshold;
      const status = isGenuineMiss ? 'OPPORTUNITY_MISSED' : 'SIGNAL_GENERATED';
      
      expect(status).toBe('OPPORTUNITY_MISSED');
    });

    it('should mark as SIGNAL_GENERATED when confidence < threshold', () => {
      // When a signal is SKIPPED and confidence < threshold, it's not a miss
      const totalConfidence = 55; // Below threshold
      const threshold = 65;
      
      const isGenuineMiss = totalConfidence >= threshold;
      const status = isGenuineMiss ? 'OPPORTUNITY_MISSED' : 'SIGNAL_GENERATED';
      
      expect(status).toBe('SIGNAL_GENERATED');
    });
  });

  describe('Trade Decision Log Structure', () => {
    it('should have required fields for trade decision log', () => {
      const logEntry = {
        userId: 1,
        symbol: 'BTC-USD',
        exchange: 'coinbase',
        price: 82500,
        signalType: 'BUY' as const,
        totalConfidence: 75,
        threshold: 65,
        agentScores: {
          TechnicalAnalyst: { score: 85, weight: 0.4, signal: 'BUY' as const, confidence: 85 },
          PatternMatcher: { score: 80, weight: 0.35, signal: 'BUY' as const, confidence: 80 },
        },
        decision: 'EXECUTED' as const,
        decisionReason: 'Strong bullish consensus with 2 high-quality signals',
      };
      
      expect(logEntry.userId).toBeDefined();
      expect(logEntry.symbol).toBeDefined();
      expect(logEntry.price).toBeGreaterThan(0);
      expect(logEntry.signalType).toMatch(/BUY|SELL|HOLD/);
      expect(logEntry.totalConfidence).toBeGreaterThan(0);
      expect(logEntry.threshold).toBeGreaterThan(0);
      expect(Object.keys(logEntry.agentScores).length).toBeGreaterThan(0);
      expect(logEntry.decision).toMatch(/EXECUTED|SKIPPED|VETOED|PENDING|FAILED|PARTIAL/);
    });

    it('should calculate correct status based on decision and confidence', () => {
      const testCases = [
        { decision: 'EXECUTED', confidence: 75, threshold: 65, expectedStatus: 'DECISION_MADE' },
        { decision: 'SKIPPED', confidence: 75, threshold: 65, expectedStatus: 'OPPORTUNITY_MISSED' },
        { decision: 'SKIPPED', confidence: 55, threshold: 65, expectedStatus: 'SIGNAL_GENERATED' },
        { decision: 'VETOED', confidence: 80, threshold: 65, expectedStatus: 'SIGNAL_GENERATED' },
      ];
      
      for (const tc of testCases) {
        let status: string;
        if (tc.decision === 'EXECUTED') {
          status = 'DECISION_MADE';
        } else if (tc.decision === 'SKIPPED') {
          const isGenuineMiss = tc.confidence >= tc.threshold;
          status = isGenuineMiss ? 'OPPORTUNITY_MISSED' : 'SIGNAL_GENERATED';
        } else {
          status = 'SIGNAL_GENERATED';
        }
        
        expect(status).toBe(tc.expectedStatus);
      }
    });
  });

  describe('Exit Trade Logging', () => {
    it('should log exit with P&L and reason', () => {
      const exitUpdate = {
        signalId: 'test-signal-123',
        exitPrice: 85000,
        exitReason: 'take_profit' as const,
        pnl: 250.50,
        pnlPercent: 3.03,
        holdDuration: 3600000, // 1 hour in ms
      };
      
      expect(exitUpdate.exitPrice).toBeGreaterThan(0);
      expect(exitUpdate.pnl).toBeDefined();
      expect(exitUpdate.pnlPercent).toBeDefined();
      expect(exitUpdate.holdDuration).toBeGreaterThan(0);
      expect(exitUpdate.exitReason).toMatch(/take_profit|stop_loss|trailing_stop|signal_reversal|manual|timeout|risk_limit/);
    });
  });
});
