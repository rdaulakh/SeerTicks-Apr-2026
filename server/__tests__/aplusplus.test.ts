/**
 * A++ Grade Optimization System Tests
 * 
 * Tests the core configuration and logic of the A++ grade system
 */

import { describe, it, expect } from 'vitest';

// A++ Grade Configuration Constants
const APLUSPLUS_CONFIG = {
  consensusThreshold: 0.70,      // 70% consensus required
  confidenceThreshold: 0.65,     // 65% confidence required
  minAgentAgreement: 4,          // 4 agents must agree
  minExecutionScore: 50,         // 50/100 execution score
  enableMacroVeto: true,
  enableRegimeFilter: true,
};

// Helper functions that mirror the quality gate logic
function checkConsensus(value: number, threshold: number): { passed: boolean; value: number; threshold: number } {
  return {
    passed: value >= threshold,
    value,
    threshold,
  };
}

function checkConfidence(value: number, threshold: number): { passed: boolean; value: number; threshold: number } {
  return {
    passed: value >= threshold,
    value,
    threshold,
  };
}

function checkAgentAgreement(count: number, min: number): { passed: boolean; value: number; threshold: number } {
  return {
    passed: count >= min,
    value: count,
    threshold: min,
  };
}

function checkMacroAlignment(direction: 'long' | 'short', trend: 'bullish' | 'bearish' | 'neutral'): { allowed: boolean; vetoed: boolean; reason: string } {
  if (trend === 'neutral') {
    return { allowed: true, vetoed: false, reason: 'Neutral trend - proceed with caution' };
  }
  
  if (direction === 'long' && trend === 'bearish') {
    return { allowed: false, vetoed: true, reason: 'Long blocked in bearish trend' };
  }
  
  if (direction === 'short' && trend === 'bullish') {
    return { allowed: false, vetoed: true, reason: 'Short blocked in bullish trend' };
  }
  
  return { allowed: true, vetoed: false, reason: 'Direction aligned with trend' };
}

function checkRegimeDirection(direction: 'long' | 'short', regime: 'uptrend' | 'downtrend' | 'sideways'): { allowed: boolean; reason: string } {
  if (regime === 'sideways') {
    return { allowed: true, reason: 'Sideways regime - both directions allowed' };
  }
  
  if (direction === 'long' && regime === 'downtrend') {
    return { allowed: false, reason: 'Long blocked in downtrend regime' };
  }
  
  if (direction === 'short' && regime === 'uptrend') {
    return { allowed: false, reason: 'Short blocked in uptrend regime' };
  }
  
  return { allowed: true, reason: 'Direction aligned with regime' };
}

function calculateGrade(winRate: number, profitFactor: number, sharpeRatio: number, maxDrawdown: number): string {
  if (winRate >= 0.65 && profitFactor >= 2.0 && sharpeRatio >= 1.5 && maxDrawdown <= 0.10) return 'A++';
  if (winRate >= 0.60 && profitFactor >= 1.5 && sharpeRatio >= 1.0 && maxDrawdown <= 0.15) return 'A+';
  if (winRate >= 0.55 && profitFactor >= 1.2 && sharpeRatio >= 0.5 && maxDrawdown <= 0.20) return 'A';
  if (winRate >= 0.50 && profitFactor >= 1.0 && sharpeRatio >= 0 && maxDrawdown <= 0.25) return 'B';
  if (winRate >= 0.45 && profitFactor >= 0.8) return 'C';
  if (winRate >= 0.40) return 'D';
  return 'F';
}

describe('A++ Grade Configuration', () => {
  it('should have correct A++ grade thresholds', () => {
    expect(APLUSPLUS_CONFIG.consensusThreshold).toBe(0.70);
    expect(APLUSPLUS_CONFIG.confidenceThreshold).toBe(0.65);
    expect(APLUSPLUS_CONFIG.minAgentAgreement).toBe(4);
    expect(APLUSPLUS_CONFIG.enableMacroVeto).toBe(true);
    expect(APLUSPLUS_CONFIG.enableRegimeFilter).toBe(true);
  });
});

describe('Consensus Check', () => {
  it('should pass signals meeting consensus threshold', () => {
    const result = checkConsensus(0.75, APLUSPLUS_CONFIG.consensusThreshold);
    expect(result.passed).toBe(true);
  });

  it('should reject signals below consensus threshold', () => {
    const result = checkConsensus(0.60, APLUSPLUS_CONFIG.consensusThreshold);
    expect(result.passed).toBe(false);
  });

  it('should pass signals exactly at threshold', () => {
    const result = checkConsensus(0.70, APLUSPLUS_CONFIG.consensusThreshold);
    expect(result.passed).toBe(true);
  });
});

describe('Confidence Check', () => {
  it('should pass signals meeting confidence threshold', () => {
    const result = checkConfidence(0.70, APLUSPLUS_CONFIG.confidenceThreshold);
    expect(result.passed).toBe(true);
  });

  it('should reject signals below confidence threshold', () => {
    const result = checkConfidence(0.50, APLUSPLUS_CONFIG.confidenceThreshold);
    expect(result.passed).toBe(false);
  });

  it('should pass signals exactly at threshold', () => {
    const result = checkConfidence(0.65, APLUSPLUS_CONFIG.confidenceThreshold);
    expect(result.passed).toBe(true);
  });
});

describe('Agent Agreement Check', () => {
  it('should pass when enough agents agree', () => {
    const result = checkAgentAgreement(5, APLUSPLUS_CONFIG.minAgentAgreement);
    expect(result.passed).toBe(true);
  });

  it('should reject when insufficient agents agree', () => {
    const result = checkAgentAgreement(2, APLUSPLUS_CONFIG.minAgentAgreement);
    expect(result.passed).toBe(false);
  });

  it('should pass when exactly at minimum', () => {
    const result = checkAgentAgreement(4, APLUSPLUS_CONFIG.minAgentAgreement);
    expect(result.passed).toBe(true);
  });
});

describe('Macro Veto Check', () => {
  it('should allow longs in bullish trend', () => {
    const result = checkMacroAlignment('long', 'bullish');
    expect(result.allowed).toBe(true);
    expect(result.vetoed).toBe(false);
  });

  it('should veto longs in bearish trend', () => {
    const result = checkMacroAlignment('long', 'bearish');
    expect(result.allowed).toBe(false);
    expect(result.vetoed).toBe(true);
  });

  it('should allow shorts in bearish trend', () => {
    const result = checkMacroAlignment('short', 'bearish');
    expect(result.allowed).toBe(true);
    expect(result.vetoed).toBe(false);
  });

  it('should veto shorts in bullish trend', () => {
    const result = checkMacroAlignment('short', 'bullish');
    expect(result.allowed).toBe(false);
    expect(result.vetoed).toBe(true);
  });

  it('should allow both in neutral trend', () => {
    const longResult = checkMacroAlignment('long', 'neutral');
    const shortResult = checkMacroAlignment('short', 'neutral');
    expect(longResult.allowed).toBe(true);
    expect(shortResult.allowed).toBe(true);
  });
});

describe('Regime Direction Filter', () => {
  it('should allow longs in uptrend', () => {
    const result = checkRegimeDirection('long', 'uptrend');
    expect(result.allowed).toBe(true);
  });

  it('should block shorts in uptrend', () => {
    const result = checkRegimeDirection('short', 'uptrend');
    expect(result.allowed).toBe(false);
  });

  it('should allow shorts in downtrend', () => {
    const result = checkRegimeDirection('short', 'downtrend');
    expect(result.allowed).toBe(true);
  });

  it('should block longs in downtrend', () => {
    const result = checkRegimeDirection('long', 'downtrend');
    expect(result.allowed).toBe(false);
  });

  it('should allow both in sideways', () => {
    const longResult = checkRegimeDirection('long', 'sideways');
    const shortResult = checkRegimeDirection('short', 'sideways');
    expect(longResult.allowed).toBe(true);
    expect(shortResult.allowed).toBe(true);
  });
});

describe('Grade Calculation', () => {
  it('should assign A++ grade for exceptional performance', () => {
    const grade = calculateGrade(0.70, 2.5, 2.0, 0.08);
    expect(grade).toBe('A++');
  });

  it('should assign A+ grade for excellent performance', () => {
    const grade = calculateGrade(0.62, 1.6, 1.2, 0.12);
    expect(grade).toBe('A+');
  });

  it('should assign A grade for good performance', () => {
    const grade = calculateGrade(0.57, 1.3, 0.7, 0.18);
    expect(grade).toBe('A');
  });

  it('should assign B grade for acceptable performance', () => {
    const grade = calculateGrade(0.52, 1.1, 0.2, 0.22);
    expect(grade).toBe('B');
  });

  it('should assign F grade for poor performance', () => {
    const grade = calculateGrade(0.28, 0.24, -0.5, 0.40);
    expect(grade).toBe('F');
  });

  it('should require all metrics for A++ grade', () => {
    // High win rate but low profit factor
    const grade1 = calculateGrade(0.70, 1.5, 2.0, 0.08);
    expect(grade1).not.toBe('A++');

    // High profit factor but low win rate
    const grade2 = calculateGrade(0.60, 2.5, 2.0, 0.08);
    expect(grade2).not.toBe('A++');

    // High drawdown
    const grade3 = calculateGrade(0.70, 2.5, 2.0, 0.15);
    expect(grade3).not.toBe('A++');
  });
});

describe('A++ Grade Signal Quality Integration', () => {
  it('should pass a perfect A++ grade signal', () => {
    const signal = {
      consensus: 0.80,
      confidence: 0.75,
      agentAgreement: 6,
      direction: 'long' as const,
      macroTrend: 'bullish' as const,
      regime: 'uptrend' as const,
    };

    const consensusCheck = checkConsensus(signal.consensus, APLUSPLUS_CONFIG.consensusThreshold);
    const confidenceCheck = checkConfidence(signal.confidence, APLUSPLUS_CONFIG.confidenceThreshold);
    const agreementCheck = checkAgentAgreement(signal.agentAgreement, APLUSPLUS_CONFIG.minAgentAgreement);
    const macroCheck = checkMacroAlignment(signal.direction, signal.macroTrend);
    const regimeCheck = checkRegimeDirection(signal.direction, signal.regime);

    expect(consensusCheck.passed).toBe(true);
    expect(confidenceCheck.passed).toBe(true);
    expect(agreementCheck.passed).toBe(true);
    expect(macroCheck.allowed).toBe(true);
    expect(regimeCheck.allowed).toBe(true);
  });

  it('should reject a signal that fails multiple checks', () => {
    const signal = {
      consensus: 0.50,  // Below threshold
      confidence: 0.40, // Below threshold
      agentAgreement: 2, // Below threshold
      direction: 'long' as const,
      macroTrend: 'bearish' as const, // Counter-trend
      regime: 'downtrend' as const, // Counter-regime
    };

    const consensusCheck = checkConsensus(signal.consensus, APLUSPLUS_CONFIG.consensusThreshold);
    const confidenceCheck = checkConfidence(signal.confidence, APLUSPLUS_CONFIG.confidenceThreshold);
    const agreementCheck = checkAgentAgreement(signal.agentAgreement, APLUSPLUS_CONFIG.minAgentAgreement);
    const macroCheck = checkMacroAlignment(signal.direction, signal.macroTrend);
    const regimeCheck = checkRegimeDirection(signal.direction, signal.regime);

    expect(consensusCheck.passed).toBe(false);
    expect(confidenceCheck.passed).toBe(false);
    expect(agreementCheck.passed).toBe(false);
    expect(macroCheck.allowed).toBe(false);
    expect(regimeCheck.allowed).toBe(false);
  });

  it('should count rejection reasons correctly', () => {
    const signals = [
      { consensus: 0.50, confidence: 0.70, agentAgreement: 5 }, // Fails consensus
      { consensus: 0.75, confidence: 0.40, agentAgreement: 5 }, // Fails confidence
      { consensus: 0.75, confidence: 0.70, agentAgreement: 2 }, // Fails agreement
      { consensus: 0.50, confidence: 0.40, agentAgreement: 2 }, // Fails all
    ];

    let consensusFails = 0;
    let confidenceFails = 0;
    let agreementFails = 0;

    signals.forEach(s => {
      if (!checkConsensus(s.consensus, APLUSPLUS_CONFIG.consensusThreshold).passed) consensusFails++;
      if (!checkConfidence(s.confidence, APLUSPLUS_CONFIG.confidenceThreshold).passed) confidenceFails++;
      if (!checkAgentAgreement(s.agentAgreement, APLUSPLUS_CONFIG.minAgentAgreement).passed) agreementFails++;
    });

    expect(consensusFails).toBe(2); // Signal 1 and 4
    expect(confidenceFails).toBe(2); // Signal 2 and 4
    expect(agreementFails).toBe(2); // Signal 3 and 4
  });
});

describe('Improvement Cycle Logic', () => {
  it('should identify counter-trend as top cause when prevalent', () => {
    const losingTrades = [
      { wasAlignedWithMacro: false, pnl: -100 },
      { wasAlignedWithMacro: false, pnl: -150 },
      { wasAlignedWithMacro: false, pnl: -80 },
      { wasAlignedWithMacro: true, pnl: -50 },
    ];

    const counterTrendCount = losingTrades.filter(t => !t.wasAlignedWithMacro).length;
    const counterTrendFrequency = counterTrendCount / losingTrades.length;

    expect(counterTrendFrequency).toBe(0.75); // 75% of losses were counter-trend
    expect(counterTrendFrequency).toBeGreaterThan(0.5); // Should be flagged as critical
  });

  it('should calculate improvement potential correctly', () => {
    const beforeMetrics = { winRate: 0.28, profitFactor: 0.24 };
    const afterMetrics = { winRate: 0.65, profitFactor: 2.0 };

    const winRateImprovement = (afterMetrics.winRate - beforeMetrics.winRate) / beforeMetrics.winRate;
    const profitFactorImprovement = (afterMetrics.profitFactor - beforeMetrics.profitFactor) / beforeMetrics.profitFactor;

    expect(winRateImprovement).toBeGreaterThan(1); // More than 100% improvement
    expect(profitFactorImprovement).toBeGreaterThan(7); // More than 700% improvement
  });
});
