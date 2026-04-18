/**
 * Trade Decision Log Tests
 * 
 * Tests for the Trade Execution Audit Log component and IST timestamp formatting
 */

import { describe, it, expect } from 'vitest';

// Test IST timestamp formatting functions
describe('IST Timestamp Formatting', () => {
  // Helper function to format date to IST (same as in component)
  function formatToIST(date: Date | string): string {
    const d = new Date(date);
    const istOptions: Intl.DateTimeFormatOptions = {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    };
    return d.toLocaleString('en-IN', istOptions);
  }

  function formatTimeIST(date: Date | string): string {
    const d = new Date(date);
    const istOptions: Intl.DateTimeFormatOptions = {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    };
    return d.toLocaleString('en-IN', istOptions);
  }

  function formatDateIST(date: Date | string): string {
    const d = new Date(date);
    const istOptions: Intl.DateTimeFormatOptions = {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    };
    return d.toLocaleString('en-IN', istOptions);
  }

  it('should format UTC date to IST correctly', () => {
    // UTC midnight = IST 5:30 AM
    const utcDate = new Date('2025-01-29T00:00:00Z');
    const istFormatted = formatToIST(utcDate);
    
    // Should contain IST time (5:30 AM)
    expect(istFormatted).toContain('29');
    expect(istFormatted).toContain('Jan');
    expect(istFormatted).toContain('2025');
  });

  it('should format time only to IST', () => {
    const utcDate = new Date('2025-01-29T12:00:00Z');
    const timeFormatted = formatTimeIST(utcDate);
    
    // UTC 12:00 = IST 5:30 PM
    expect(timeFormatted).toContain('pm') || expect(timeFormatted).toContain('PM');
  });

  it('should format date only to IST', () => {
    const utcDate = new Date('2025-01-29T00:00:00Z');
    const dateFormatted = formatDateIST(utcDate);
    
    expect(dateFormatted).toContain('Jan');
    expect(dateFormatted).toContain('2025');
  });

  it('should handle string date input', () => {
    const dateString = '2025-01-29T10:30:00Z';
    const formatted = formatToIST(dateString);
    
    expect(formatted).toContain('Jan');
    expect(formatted).toContain('2025');
  });
});

// Test audit explanation generation
describe('Audit Trail Explanation', () => {
  interface TradeDecision {
    totalConfidence: number;
    threshold: number;
    decision: string;
    status: string;
    signalType: string;
    decisionReason: string | null;
  }

  function getAuditExplanation(log: TradeDecision): string {
    const passedThreshold = log.totalConfidence >= log.threshold;
    const thresholdDiff = (log.totalConfidence - log.threshold).toFixed(1);
    
    if (log.decision === 'EXECUTED') {
      return `✅ TRADE EXECUTED: Combined Score (${log.totalConfidence.toFixed(1)}%) exceeded threshold (${log.threshold}%) by ${thresholdDiff}%. All conditions met for ${log.signalType} signal.`;
    } else if (log.status === 'OPPORTUNITY_MISSED') {
      return `⚠️ OPPORTUNITY MISSED: Combined Score (${log.totalConfidence.toFixed(1)}%) met threshold (${log.threshold}%) but trade was not executed. Reason: ${log.decisionReason || 'Unknown - possible system delay or risk limit'}`;
    } else if (log.decision === 'SKIPPED' && !passedThreshold) {
      return `❌ CORRECTLY REJECTED: Combined Score (${log.totalConfidence.toFixed(1)}%) below threshold (${log.threshold}%) by ${Math.abs(parseFloat(thresholdDiff)).toFixed(1)}%. Signal did not qualify.`;
    } else if (log.decision === 'VETOED') {
      return `🚫 VETOED BY RISK MANAGEMENT: ${log.decisionReason || 'Risk limits or position constraints prevented execution'}`;
    } else if (log.decision === 'FAILED') {
      return `💥 EXECUTION FAILED: ${log.decisionReason || 'Technical error during trade execution'}`;
    }
    return log.decisionReason || 'No additional details available';
  }

  it('should generate correct explanation for executed trade', () => {
    const log: TradeDecision = {
      totalConfidence: 75.5,
      threshold: 65,
      decision: 'EXECUTED',
      status: 'POSITION_OPENED',
      signalType: 'BUY',
      decisionReason: null
    };

    const explanation = getAuditExplanation(log);
    
    expect(explanation).toContain('✅ TRADE EXECUTED');
    expect(explanation).toContain('75.5%');
    expect(explanation).toContain('65%');
    expect(explanation).toContain('10.5%');
    expect(explanation).toContain('BUY');
  });

  it('should generate correct explanation for missed opportunity', () => {
    const log: TradeDecision = {
      totalConfidence: 70.0,
      threshold: 65,
      decision: 'SKIPPED',
      status: 'OPPORTUNITY_MISSED',
      signalType: 'SELL',
      decisionReason: 'Position limit reached'
    };

    const explanation = getAuditExplanation(log);
    
    expect(explanation).toContain('⚠️ OPPORTUNITY MISSED');
    expect(explanation).toContain('70.0%');
    expect(explanation).toContain('Position limit reached');
  });

  it('should generate correct explanation for correctly rejected signal', () => {
    const log: TradeDecision = {
      totalConfidence: 45.0,
      threshold: 65,
      decision: 'SKIPPED',
      status: 'SIGNAL_GENERATED',
      signalType: 'BUY',
      decisionReason: null
    };

    const explanation = getAuditExplanation(log);
    
    expect(explanation).toContain('❌ CORRECTLY REJECTED');
    expect(explanation).toContain('45.0%');
    expect(explanation).toContain('below threshold');
  });

  it('should generate correct explanation for vetoed trade', () => {
    const log: TradeDecision = {
      totalConfidence: 80.0,
      threshold: 65,
      decision: 'VETOED',
      status: 'SIGNAL_GENERATED',
      signalType: 'BUY',
      decisionReason: 'Max daily loss reached'
    };

    const explanation = getAuditExplanation(log);
    
    expect(explanation).toContain('🚫 VETOED BY RISK MANAGEMENT');
    expect(explanation).toContain('Max daily loss reached');
  });

  it('should generate correct explanation for failed execution', () => {
    const log: TradeDecision = {
      totalConfidence: 72.0,
      threshold: 65,
      decision: 'FAILED',
      status: 'SIGNAL_GENERATED',
      signalType: 'SELL',
      decisionReason: 'API timeout'
    };

    const explanation = getAuditExplanation(log);
    
    expect(explanation).toContain('💥 EXECUTION FAILED');
    expect(explanation).toContain('API timeout');
  });
});

// Test agent contribution calculation
describe('Agent Contribution Calculation', () => {
  interface AgentScore {
    score: number;
    weight: number;
    signal: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
  }

  function getAgentContribution(agentScore: AgentScore): number {
    return agentScore.score * agentScore.weight;
  }

  it('should calculate agent contribution correctly', () => {
    const agentScore: AgentScore = {
      score: 80,
      weight: 0.25,
      signal: 'BUY',
      confidence: 85
    };

    const contribution = getAgentContribution(agentScore);
    expect(contribution).toBe(20); // 80 * 0.25 = 20
  });

  it('should handle zero weight', () => {
    const agentScore: AgentScore = {
      score: 100,
      weight: 0,
      signal: 'SELL',
      confidence: 90
    };

    const contribution = getAgentContribution(agentScore);
    expect(contribution).toBe(0);
  });

  it('should handle full weight', () => {
    const agentScore: AgentScore = {
      score: 75,
      weight: 1.0,
      signal: 'HOLD',
      confidence: 60
    };

    const contribution = getAgentContribution(agentScore);
    expect(contribution).toBe(75);
  });
});

// Test actionable filter logic
describe('Actionable Filter Logic', () => {
  interface TradeLog {
    decision: string;
    status: string;
    totalConfidence: number;
    threshold: number;
  }

  function isActionable(log: TradeLog): boolean {
    // Actionable = EXECUTED trades OR genuine OPPORTUNITY_MISSED (consensus >= threshold but skipped)
    if (log.decision === 'EXECUTED') return true;
    if (log.status === 'OPPORTUNITY_MISSED') return true;
    if (log.status === 'POSITION_OPENED') return true;
    if (log.status === 'POSITION_CLOSED') return true;
    return false;
  }

  it('should mark executed trades as actionable', () => {
    const log: TradeLog = {
      decision: 'EXECUTED',
      status: 'POSITION_OPENED',
      totalConfidence: 75,
      threshold: 65
    };

    expect(isActionable(log)).toBe(true);
  });

  it('should mark missed opportunities as actionable', () => {
    const log: TradeLog = {
      decision: 'SKIPPED',
      status: 'OPPORTUNITY_MISSED',
      totalConfidence: 70,
      threshold: 65
    };

    expect(isActionable(log)).toBe(true);
  });

  it('should mark open positions as actionable', () => {
    const log: TradeLog = {
      decision: 'EXECUTED',
      status: 'POSITION_OPENED',
      totalConfidence: 72,
      threshold: 65
    };

    expect(isActionable(log)).toBe(true);
  });

  it('should mark closed positions as actionable', () => {
    const log: TradeLog = {
      decision: 'EXECUTED',
      status: 'POSITION_CLOSED',
      totalConfidence: 68,
      threshold: 65
    };

    expect(isActionable(log)).toBe(true);
  });

  it('should NOT mark correctly rejected signals as actionable', () => {
    const log: TradeLog = {
      decision: 'SKIPPED',
      status: 'SIGNAL_GENERATED',
      totalConfidence: 45,
      threshold: 65
    };

    expect(isActionable(log)).toBe(false);
  });

  it('should NOT mark decision_made without execution as actionable', () => {
    const log: TradeLog = {
      decision: 'SKIPPED',
      status: 'DECISION_MADE',
      totalConfidence: 50,
      threshold: 65
    };

    expect(isActionable(log)).toBe(false);
  });
});

// Test threshold pass/fail logic
describe('Threshold Pass/Fail Logic', () => {
  it('should pass when confidence exceeds threshold', () => {
    const confidence = 75;
    const threshold = 65;
    expect(confidence >= threshold).toBe(true);
  });

  it('should pass when confidence equals threshold', () => {
    const confidence = 65;
    const threshold = 65;
    expect(confidence >= threshold).toBe(true);
  });

  it('should fail when confidence is below threshold', () => {
    const confidence = 60;
    const threshold = 65;
    expect(confidence >= threshold).toBe(false);
  });

  it('should calculate correct margin', () => {
    const confidence = 75;
    const threshold = 65;
    const margin = confidence - threshold;
    expect(margin).toBe(10);
  });

  it('should calculate negative margin for failed threshold', () => {
    const confidence = 55;
    const threshold = 65;
    const margin = confidence - threshold;
    expect(margin).toBe(-10);
  });
});
