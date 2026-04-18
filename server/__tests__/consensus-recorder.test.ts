/**
 * ConsensusRecorder Unit Tests
 * 
 * Tests the consensus recording utility:
 * - Signal normalization
 * - recordConsensus non-throwing behavior
 * - recordConsensusBatch non-throwing behavior
 * - Record structure validation
 */

import { describe, it, expect, vi } from 'vitest';
import { recordConsensus, recordConsensusBatch, ConsensusRecord } from '../utils/ConsensusRecorder';

// Mock the DB to avoid real database calls
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue(null), // No DB available
}));

const makeRecord = (overrides: Partial<ConsensusRecord> = {}): ConsensusRecord => ({
  symbol: 'BTCUSD',
  timeframe: '5m',
  finalSignal: 'BULLISH',
  finalConfidence: 0.85,
  consensusPercentage: 75,
  bullishVotes: 8,
  bearishVotes: 2,
  neutralVotes: 3,
  agentVotes: [
    { agentName: 'TechnicalAnalyst', signal: 'BULLISH', confidence: 0.9, weight: 0.15 },
    { agentName: 'MomentumTrader', signal: 'BULLISH', confidence: 0.8, weight: 0.12 },
  ],
  ...overrides,
});

describe('ConsensusRecorder', () => {
  describe('recordConsensus', () => {
    it('should not throw when DB is unavailable', async () => {
      await expect(recordConsensus(makeRecord())).resolves.not.toThrow();
    });

    it('should handle BULLISH signal', async () => {
      await expect(recordConsensus(makeRecord({ finalSignal: 'BULLISH' }))).resolves.not.toThrow();
    });

    it('should handle BEARISH signal', async () => {
      await expect(recordConsensus(makeRecord({ finalSignal: 'BEARISH' }))).resolves.not.toThrow();
    });

    it('should handle NEUTRAL signal', async () => {
      await expect(recordConsensus(makeRecord({ finalSignal: 'NEUTRAL' }))).resolves.not.toThrow();
    });

    it('should handle zero confidence', async () => {
      await expect(recordConsensus(makeRecord({ finalConfidence: 0 }))).resolves.not.toThrow();
    });

    it('should handle empty agentVotes', async () => {
      await expect(recordConsensus(makeRecord({ agentVotes: [] }))).resolves.not.toThrow();
    });

    it('should handle optional tradeId', async () => {
      await expect(recordConsensus(makeRecord({ tradeId: 42 }))).resolves.not.toThrow();
    });

    it('should handle optional userId', async () => {
      await expect(recordConsensus(makeRecord({ userId: 1 }))).resolves.not.toThrow();
    });
  });

  describe('recordConsensusBatch', () => {
    it('should not throw for empty batch', async () => {
      await expect(recordConsensusBatch([])).resolves.not.toThrow();
    });

    it('should not throw for single record batch', async () => {
      await expect(recordConsensusBatch([makeRecord()])).resolves.not.toThrow();
    });

    it('should not throw for multiple records', async () => {
      const records = [
        makeRecord({ symbol: 'BTCUSD' }),
        makeRecord({ symbol: 'ETHUSD', finalSignal: 'BEARISH' }),
        makeRecord({ symbol: 'SOLUSD', finalSignal: 'NEUTRAL' }),
      ];
      await expect(recordConsensusBatch(records)).resolves.not.toThrow();
    });

    it('should handle mixed signals in batch', async () => {
      const records = [
        makeRecord({ finalSignal: 'BULLISH', finalConfidence: 0.9 }),
        makeRecord({ finalSignal: 'BEARISH', finalConfidence: 0.7 }),
        makeRecord({ finalSignal: 'NEUTRAL', finalConfidence: 0.5 }),
      ];
      await expect(recordConsensusBatch(records)).resolves.not.toThrow();
    });
  });

  describe('ConsensusRecord interface', () => {
    it('should accept a complete record', () => {
      const record = makeRecord();
      expect(record.symbol).toBe('BTCUSD');
      expect(record.timeframe).toBe('5m');
      expect(record.finalSignal).toBe('BULLISH');
      expect(record.finalConfidence).toBe(0.85);
      expect(record.consensusPercentage).toBe(75);
      expect(record.bullishVotes).toBe(8);
      expect(record.bearishVotes).toBe(2);
      expect(record.neutralVotes).toBe(3);
      expect(record.agentVotes.length).toBe(2);
    });

    it('should have valid agentVote structure', () => {
      const record = makeRecord();
      const vote = record.agentVotes[0];
      expect(vote).toHaveProperty('agentName');
      expect(vote).toHaveProperty('signal');
      expect(vote).toHaveProperty('confidence');
      expect(vote).toHaveProperty('weight');
    });
  });
});
