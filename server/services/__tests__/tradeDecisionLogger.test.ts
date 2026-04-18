/**
 * Trade Decision Logger Tests
 * 
 * Tests the status determination logic for trade decision logging
 * Verifies that:
 * - EXECUTED trades are marked as DECISION_MADE
 * - SKIPPED signals with consensus >= threshold are marked as OPPORTUNITY_MISSED (genuine miss)
 * - SKIPPED signals with consensus < threshold are marked as SIGNAL_GENERATED (correctly rejected)
 */

import { describe, it, expect } from 'vitest';

// Test the status determination logic directly (extracted from tradeDecisionLogger.ts)
function determineStatus(
  decision: 'EXECUTED' | 'SKIPPED' | 'VETOED' | 'PENDING' | 'FAILED' | 'PARTIAL',
  totalConfidence: number,
  threshold: number
): 'DECISION_MADE' | 'OPPORTUNITY_MISSED' | 'SIGNAL_GENERATED' {
  if (decision === 'EXECUTED') {
    return 'DECISION_MADE';
  } else if (decision === 'SKIPPED') {
    // Only mark as OPPORTUNITY_MISSED if consensus was above threshold
    // This is a genuine miss - the signal qualified but wasn't executed
    const isGenuineMiss = totalConfidence >= threshold;
    return isGenuineMiss ? 'OPPORTUNITY_MISSED' : 'SIGNAL_GENERATED';
  } else {
    return 'SIGNAL_GENERATED';
  }
}

describe('TradeDecisionLogger Status Determination', () => {
  describe('EXECUTED trades', () => {
    it('should mark EXECUTED trades as DECISION_MADE regardless of confidence', () => {
      expect(determineStatus('EXECUTED', 80, 65)).toBe('DECISION_MADE');
      expect(determineStatus('EXECUTED', 65, 65)).toBe('DECISION_MADE');
      expect(determineStatus('EXECUTED', 50, 65)).toBe('DECISION_MADE');
    });
  });

  describe('SKIPPED signals - Genuine Missed Opportunities', () => {
    it('should mark SKIPPED signals with confidence >= threshold as OPPORTUNITY_MISSED', () => {
      // Confidence exactly at threshold
      expect(determineStatus('SKIPPED', 65, 65)).toBe('OPPORTUNITY_MISSED');
      
      // Confidence above threshold
      expect(determineStatus('SKIPPED', 70, 65)).toBe('OPPORTUNITY_MISSED');
      expect(determineStatus('SKIPPED', 80, 65)).toBe('OPPORTUNITY_MISSED');
      expect(determineStatus('SKIPPED', 95, 65)).toBe('OPPORTUNITY_MISSED');
    });

    it('should handle edge case where confidence equals threshold exactly', () => {
      expect(determineStatus('SKIPPED', 65.0, 65.0)).toBe('OPPORTUNITY_MISSED');
      expect(determineStatus('SKIPPED', 70.0, 70.0)).toBe('OPPORTUNITY_MISSED');
    });
  });

  describe('SKIPPED signals - Correctly Rejected', () => {
    it('should mark SKIPPED signals with confidence < threshold as SIGNAL_GENERATED', () => {
      // Confidence below threshold
      expect(determineStatus('SKIPPED', 64, 65)).toBe('SIGNAL_GENERATED');
      expect(determineStatus('SKIPPED', 50, 65)).toBe('SIGNAL_GENERATED');
      expect(determineStatus('SKIPPED', 30, 65)).toBe('SIGNAL_GENERATED');
      expect(determineStatus('SKIPPED', 0, 65)).toBe('SIGNAL_GENERATED');
    });

    it('should handle edge case where confidence is just below threshold', () => {
      expect(determineStatus('SKIPPED', 64.99, 65)).toBe('SIGNAL_GENERATED');
      expect(determineStatus('SKIPPED', 64.9, 65)).toBe('SIGNAL_GENERATED');
    });
  });

  describe('Other decision types', () => {
    it('should mark VETOED signals as SIGNAL_GENERATED', () => {
      expect(determineStatus('VETOED', 80, 65)).toBe('SIGNAL_GENERATED');
      expect(determineStatus('VETOED', 50, 65)).toBe('SIGNAL_GENERATED');
    });

    it('should mark PENDING signals as SIGNAL_GENERATED', () => {
      expect(determineStatus('PENDING', 80, 65)).toBe('SIGNAL_GENERATED');
    });

    it('should mark FAILED signals as SIGNAL_GENERATED', () => {
      expect(determineStatus('FAILED', 80, 65)).toBe('SIGNAL_GENERATED');
    });

    it('should mark PARTIAL signals as SIGNAL_GENERATED', () => {
      expect(determineStatus('PARTIAL', 80, 65)).toBe('SIGNAL_GENERATED');
    });
  });

  describe('Real-world scenarios', () => {
    it('should correctly classify a high-confidence signal that was skipped due to other reasons', () => {
      // Example: BTC-USD with 73.36% confidence, threshold 65%
      // This should be marked as OPPORTUNITY_MISSED (genuine miss)
      expect(determineStatus('SKIPPED', 73.36, 65)).toBe('OPPORTUNITY_MISSED');
    });

    it('should correctly classify a low-confidence signal that was correctly rejected', () => {
      // Example: Signal with 55% confidence, threshold 65%
      // This should be marked as SIGNAL_GENERATED (correctly rejected)
      expect(determineStatus('SKIPPED', 55, 65)).toBe('SIGNAL_GENERATED');
    });

    it('should correctly classify an executed trade', () => {
      // Example: BTC-USD with 80% confidence, executed
      expect(determineStatus('EXECUTED', 80, 65)).toBe('DECISION_MADE');
    });
  });
});

describe('TradeDecisionLog UI Filtering Logic', () => {
  // Test the client-side filtering logic
  interface MockLog {
    decision: string;
    status: string;
    totalConfidence: number;
    threshold: number;
  }

  function filterActionableLogs(logs: MockLog[]): MockLog[] {
    return logs.filter(log => {
      // Always show executed trades
      if (log.decision === 'EXECUTED') return true;
      // Show genuine missed opportunities (consensus >= threshold but skipped)
      if (log.status === 'OPPORTUNITY_MISSED' && log.totalConfidence >= log.threshold) return true;
      // Hide correctly rejected signals (below threshold)
      return false;
    });
  }

  it('should include EXECUTED trades in actionable view', () => {
    const logs: MockLog[] = [
      { decision: 'EXECUTED', status: 'DECISION_MADE', totalConfidence: 80, threshold: 65 },
      { decision: 'EXECUTED', status: 'POSITION_CLOSED', totalConfidence: 75, threshold: 65 },
    ];
    
    const filtered = filterActionableLogs(logs);
    expect(filtered).toHaveLength(2);
  });

  it('should include genuine OPPORTUNITY_MISSED in actionable view', () => {
    const logs: MockLog[] = [
      { decision: 'SKIPPED', status: 'OPPORTUNITY_MISSED', totalConfidence: 70, threshold: 65 },
      { decision: 'SKIPPED', status: 'OPPORTUNITY_MISSED', totalConfidence: 80, threshold: 65 },
    ];
    
    const filtered = filterActionableLogs(logs);
    expect(filtered).toHaveLength(2);
  });

  it('should exclude correctly rejected signals from actionable view', () => {
    const logs: MockLog[] = [
      { decision: 'SKIPPED', status: 'SIGNAL_GENERATED', totalConfidence: 50, threshold: 65 },
      { decision: 'SKIPPED', status: 'SIGNAL_GENERATED', totalConfidence: 60, threshold: 65 },
    ];
    
    const filtered = filterActionableLogs(logs);
    expect(filtered).toHaveLength(0);
  });

  it('should correctly filter mixed logs', () => {
    const logs: MockLog[] = [
      { decision: 'EXECUTED', status: 'POSITION_CLOSED', totalConfidence: 80, threshold: 65 },
      { decision: 'SKIPPED', status: 'OPPORTUNITY_MISSED', totalConfidence: 70, threshold: 65 },
      { decision: 'SKIPPED', status: 'SIGNAL_GENERATED', totalConfidence: 50, threshold: 65 },
      { decision: 'SKIPPED', status: 'SIGNAL_GENERATED', totalConfidence: 55, threshold: 65 },
      { decision: 'EXECUTED', status: 'DECISION_MADE', totalConfidence: 75, threshold: 65 },
    ];
    
    const filtered = filterActionableLogs(logs);
    expect(filtered).toHaveLength(3); // 2 EXECUTED + 1 genuine OPPORTUNITY_MISSED
    expect(filtered.filter(l => l.decision === 'EXECUTED')).toHaveLength(2);
    expect(filtered.filter(l => l.status === 'OPPORTUNITY_MISSED')).toHaveLength(1);
  });
});
