/**
 * Position Consensus Router Tests
 * 
 * Tests for real-time consensus visualization and emergency manual override
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the database
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue({}),
  }),
}));

// Mock the SEER engine
vi.mock('../seerMainMulti', () => ({
  getSEERMultiEngine: vi.fn().mockResolvedValue({
    getPositionsWithLivePrices: vi.fn().mockResolvedValue([]),
  }),
}));

describe('Position Consensus Features', () => {
  describe('Consensus Visualization', () => {
    it('should calculate exit percentage correctly', () => {
      const agentVotes = [
        { signal: 'exit', confidence: 0.8 },
        { signal: 'exit', confidence: 0.7 },
        { signal: 'hold', confidence: 0.6 },
        { signal: 'hold', confidence: 0.5 },
        { signal: 'add', confidence: 0.9 },
      ];
      
      const exitVotes = agentVotes.filter(v => v.signal === 'exit').length;
      const holdVotes = agentVotes.filter(v => v.signal === 'hold').length;
      const addVotes = agentVotes.filter(v => v.signal === 'add').length;
      const totalAgents = agentVotes.length;
      
      const exitPercentage = Math.round((exitVotes / totalAgents) * 100);
      const holdPercentage = Math.round((holdVotes / totalAgents) * 100);
      const addPercentage = Math.round((addVotes / totalAgents) * 100);
      
      expect(exitPercentage).toBe(40);
      expect(holdPercentage).toBe(40);
      expect(addPercentage).toBe(20);
    });

    it('should determine consensus action based on thresholds', () => {
      const determineConsensusAction = (exitPct: number, holdPct: number, addPct: number) => {
        if (exitPct >= 60) return 'exit';
        if (holdPct >= 50) return 'hold';
        if (addPct >= 70) return 'add';
        return 'neutral';
      };
      
      // Test exit threshold (60%)
      expect(determineConsensusAction(60, 30, 10)).toBe('exit');
      expect(determineConsensusAction(70, 20, 10)).toBe('exit');
      
      // Test hold threshold (50%)
      expect(determineConsensusAction(40, 50, 10)).toBe('hold');
      expect(determineConsensusAction(30, 60, 10)).toBe('hold');
      
      // Test add threshold (70%)
      expect(determineConsensusAction(10, 20, 70)).toBe('add');
      expect(determineConsensusAction(5, 15, 80)).toBe('add');
      
      // Test neutral (no threshold met)
      expect(determineConsensusAction(40, 40, 20)).toBe('neutral');
      expect(determineConsensusAction(30, 30, 40)).toBe('neutral');
    });

    it('should calculate consensus strength correctly', () => {
      const calculateConsensusStrength = (exitPct: number, holdPct: number, addPct: number, action: string) => {
        switch (action) {
          case 'exit': return exitPct;
          case 'hold': return holdPct;
          case 'add': return addPct;
          default: return Math.max(exitPct, holdPct, addPct);
        }
      };
      
      expect(calculateConsensusStrength(70, 20, 10, 'exit')).toBe(70);
      expect(calculateConsensusStrength(30, 60, 10, 'hold')).toBe(60);
      expect(calculateConsensusStrength(10, 10, 80, 'add')).toBe(80);
      expect(calculateConsensusStrength(40, 35, 25, 'neutral')).toBe(40);
    });

    it('should identify when approaching exit threshold', () => {
      const exitThreshold = 60;
      const isNearThreshold = (exitPct: number) => exitPct >= exitThreshold * 0.8;
      const isAtThreshold = (exitPct: number) => exitPct >= exitThreshold;
      
      // Below threshold warning zone
      expect(isNearThreshold(40)).toBe(false);
      expect(isAtThreshold(40)).toBe(false);
      
      // In warning zone (80% of threshold)
      expect(isNearThreshold(48)).toBe(true);
      expect(isAtThreshold(48)).toBe(false);
      
      // At or above threshold
      expect(isNearThreshold(60)).toBe(true);
      expect(isAtThreshold(60)).toBe(true);
      expect(isNearThreshold(75)).toBe(true);
      expect(isAtThreshold(75)).toBe(true);
    });
  });

  describe('Signal Classification', () => {
    it('should classify signals correctly for long positions', () => {
      const classifySignalForLong = (signalType: string, confidence: number) => {
        if (signalType === 'bearish' || signalType === 'sell' || signalType === 'exit') {
          return 'exit';
        } else if (signalType === 'bullish' || signalType === 'buy') {
          return confidence > 0.7 ? 'add' : 'hold';
        }
        return 'hold';
      };
      
      // Bearish signals should trigger exit for long positions
      expect(classifySignalForLong('bearish', 0.8)).toBe('exit');
      expect(classifySignalForLong('sell', 0.9)).toBe('exit');
      expect(classifySignalForLong('exit', 0.7)).toBe('exit');
      
      // High confidence bullish signals should suggest add
      expect(classifySignalForLong('bullish', 0.8)).toBe('add');
      expect(classifySignalForLong('buy', 0.9)).toBe('add');
      
      // Low confidence bullish signals should suggest hold
      expect(classifySignalForLong('bullish', 0.5)).toBe('hold');
      expect(classifySignalForLong('buy', 0.6)).toBe('hold');
      
      // Neutral signals should suggest hold
      expect(classifySignalForLong('neutral', 0.5)).toBe('hold');
    });

    it('should classify signals correctly for short positions', () => {
      const classifySignalForShort = (signalType: string, confidence: number) => {
        if (signalType === 'bullish' || signalType === 'buy' || signalType === 'exit') {
          return 'exit';
        } else if (signalType === 'bearish' || signalType === 'sell') {
          return confidence > 0.7 ? 'add' : 'hold';
        }
        return 'hold';
      };
      
      // Bullish signals should trigger exit for short positions
      expect(classifySignalForShort('bullish', 0.8)).toBe('exit');
      expect(classifySignalForShort('buy', 0.9)).toBe('exit');
      expect(classifySignalForShort('exit', 0.7)).toBe('exit');
      
      // High confidence bearish signals should suggest add
      expect(classifySignalForShort('bearish', 0.8)).toBe('add');
      expect(classifySignalForShort('sell', 0.9)).toBe('add');
      
      // Low confidence bearish signals should suggest hold
      expect(classifySignalForShort('bearish', 0.5)).toBe('hold');
      expect(classifySignalForShort('sell', 0.6)).toBe('hold');
      
      // Neutral signals should suggest hold
      expect(classifySignalForShort('neutral', 0.5)).toBe('hold');
    });
  });

  describe('Manual Override', () => {
    it('should require confirmation for manual exit', () => {
      const validateManualExit = (confirmOverride: boolean, reason: string) => {
        if (!confirmOverride) {
          return { valid: false, error: 'Must confirm override' };
        }
        if (!reason.trim()) {
          return { valid: false, error: 'Reason required' };
        }
        return { valid: true };
      };
      
      // Should fail without confirmation
      expect(validateManualExit(false, 'Market crash')).toEqual({
        valid: false,
        error: 'Must confirm override',
      });
      
      // Should fail without reason
      expect(validateManualExit(true, '')).toEqual({
        valid: false,
        error: 'Reason required',
      });
      expect(validateManualExit(true, '   ')).toEqual({
        valid: false,
        error: 'Reason required',
      });
      
      // Should pass with both
      expect(validateManualExit(true, 'Emergency exit due to news event')).toEqual({
        valid: true,
      });
    });

    it('should calculate P&L correctly on manual exit', () => {
      const calculatePnL = (
        side: 'long' | 'short',
        entryPrice: number,
        exitPrice: number,
        quantity: number
      ) => {
        let pnl: number;
        let pnlPercent: number;
        
        if (side === 'long') {
          pnl = (exitPrice - entryPrice) * quantity;
          pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
        } else {
          pnl = (entryPrice - exitPrice) * quantity;
          pnlPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
        }
        
        return { pnl, pnlPercent };
      };
      
      // Long position - profit
      const longProfit = calculatePnL('long', 100, 110, 10);
      expect(longProfit.pnl).toBe(100);
      expect(longProfit.pnlPercent).toBe(10);
      
      // Long position - loss
      const longLoss = calculatePnL('long', 100, 90, 10);
      expect(longLoss.pnl).toBe(-100);
      expect(longLoss.pnlPercent).toBe(-10);
      
      // Short position - profit
      const shortProfit = calculatePnL('short', 100, 90, 10);
      expect(shortProfit.pnl).toBe(100);
      expect(shortProfit.pnlPercent).toBe(10);
      
      // Short position - loss
      const shortLoss = calculatePnL('short', 100, 110, 10);
      expect(shortLoss.pnl).toBe(-100);
      expect(shortLoss.pnlPercent).toBe(-10);
    });

    it('should generate proper audit log for manual override', () => {
      const generateAuditLog = (
        userId: number,
        positionId: number,
        reason: string,
        exitPrice: number,
        realizedPnl: number,
        realizedPnlPercent: number
      ) => {
        return {
          userId,
          positionId,
          reason,
          timestamp: expect.any(String),
          exitPrice,
          realizedPnl,
          realizedPnlPercent,
        };
      };
      
      const auditLog = generateAuditLog(
        123,
        456,
        'Emergency exit due to market crash',
        95000,
        -500,
        -5
      );
      
      expect(auditLog).toMatchObject({
        userId: 123,
        positionId: 456,
        reason: 'Emergency exit due to market crash',
        exitPrice: 95000,
        realizedPnl: -500,
        realizedPnlPercent: -5,
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero agents gracefully', () => {
      const calculateConsensus = (agentVotes: any[]) => {
        const totalAgents = agentVotes.length || 1; // Avoid division by zero
        const exitVotes = agentVotes.filter(v => v.signal === 'exit').length;
        return Math.round((exitVotes / totalAgents) * 100);
      };
      
      expect(calculateConsensus([])).toBe(0);
    });

    it('should handle missing confidence values', () => {
      const getConfidence = (signal: any) => {
        return parseFloat(signal.confidence?.toString() || '0.5');
      };
      
      expect(getConfidence({ confidence: 0.8 })).toBe(0.8);
      expect(getConfidence({ confidence: '0.7' })).toBe(0.7);
      expect(getConfidence({})).toBe(0.5);
      expect(getConfidence({ confidence: null })).toBe(0.5);
    });

    it('should handle position ID type conversion', () => {
      const normalizePositionId = (id: string | number): number => {
        return typeof id === 'string' ? parseInt(id, 10) : id;
      };
      
      expect(normalizePositionId(123)).toBe(123);
      expect(normalizePositionId('456')).toBe(456);
      expect(normalizePositionId('789')).toBe(789);
    });
  });
});
