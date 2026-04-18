/**
 * Week 5-6 Entry System Improvements Tests
 * 
 * Tests for:
 * - EntryConfirmationFilter
 * - MultiTimeframeAlignment
 * - VolumeConfirmation
 * - EntryValidationService (integration)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EntryConfirmationFilter, AgentSignal } from '../services/EntryConfirmationFilter';
import { MultiTimeframeAlignment, Candle } from '../services/MultiTimeframeAlignment';
import { VolumeConfirmation } from '../services/VolumeConfirmation';
import { EntryValidationService } from '../services/EntryValidationService';

// Helper to generate mock candles
function generateCandles(count: number, basePrice: number, trend: 'up' | 'down' | 'flat', baseVolume: number = 1000): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  
  for (let i = 0; i < count; i++) {
    const change = trend === 'up' ? 0.002 : trend === 'down' ? -0.002 : (Math.random() - 0.5) * 0.001;
    price = price * (1 + change);
    
    candles.push({
      timestamp: Date.now() - (count - i) * 60000,
      open: price * 0.999,
      high: price * 1.002,
      low: price * 0.998,
      close: price,
      volume: baseVolume * (0.8 + Math.random() * 0.4),
    });
  }
  
  return candles;
}

// ============================================
// Entry Confirmation Filter Tests
// ============================================
describe('EntryConfirmationFilter', () => {
  let filter: EntryConfirmationFilter;

  beforeEach(() => {
    filter = new EntryConfirmationFilter();
  });

  it('should validate entry when 3+ agents agree on LONG with high confidence', () => {
    const signals: AgentSignal[] = [
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.8, weight: 0.15 },
      { agentName: 'PatternMatcher', direction: 'LONG', confidence: 0.75, weight: 0.12 },
      { agentName: 'OrderFlowAnalyst', direction: 'LONG', confidence: 0.7, weight: 0.10 },
      { agentName: 'SentimentAnalyst', direction: 'NEUTRAL', confidence: 0.5, weight: 0.08 },
    ];

    const result = filter.validateEntry(signals);
    
    expect(result.isValid).toBe(true);
    expect(result.direction).toBe('LONG');
    expect(result.agentAgreement).toBe(3);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('should reject entry when less than 3 agents agree (strict mode)', () => {
    // Phase 28: Use explicit strict config to test rejection path
    const strictFilter = new EntryConfirmationFilter({ minAgentAgreement: 3 });
    const signals: AgentSignal[] = [
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.8, weight: 0.15 },
      { agentName: 'PatternMatcher', direction: 'LONG', confidence: 0.75, weight: 0.12 },
      { agentName: 'OrderFlowAnalyst', direction: 'SHORT', confidence: 0.7, weight: 0.10 },
      { agentName: 'SentimentAnalyst', direction: 'NEUTRAL', confidence: 0.5, weight: 0.08 },
    ];

    const result = strictFilter.validateEntry(signals);
    
    expect(result.isValid).toBe(false);
    expect(result.agentAgreement).toBe(2);
    expect(result.reasons.some(r => r.includes('agent') || r.includes('agreement') || r.includes('Insufficient'))).toBe(true);
  });

  it('should accept entry with 2 agents agreeing (default production config)', () => {
    // Phase 28: Default config only requires 2 agents
    const signals: AgentSignal[] = [
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.8, weight: 0.15 },
      { agentName: 'PatternMatcher', direction: 'LONG', confidence: 0.75, weight: 0.12 },
      { agentName: 'OrderFlowAnalyst', direction: 'SHORT', confidence: 0.7, weight: 0.10 },
    ];

    const result = filter.validateEntry(signals);
    
    expect(result.isValid).toBe(true);
    expect(result.agentAgreement).toBe(2);
  });

  it('should reject entry when weighted consensus is below strict threshold', () => {
    // Phase 28: Use explicit strict config to test weighted threshold rejection
    const strictFilter = new EntryConfirmationFilter({ weightedThreshold: 0.70 });
    const signals: AgentSignal[] = [
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.65, weight: 0.10 },
      { agentName: 'PatternMatcher', direction: 'LONG', confidence: 0.62, weight: 0.10 },
      { agentName: 'OrderFlowAnalyst', direction: 'LONG', confidence: 0.61, weight: 0.10 },
      { agentName: 'SentimentAnalyst', direction: 'SHORT', confidence: 0.8, weight: 0.15 },
    ];

    const result = strictFilter.validateEntry(signals);
    
    expect(result.isValid).toBe(false);
    expect(result.reasons.some(r => r.includes('consensus') || r.includes('Weighted') || r.includes('threshold'))).toBe(true);
  });

  it('should filter out low-confidence agents (strict mode)', () => {
    // Phase 28: Use strict config to test confidence filtering
    const strictFilter = new EntryConfirmationFilter({ minConfidenceScore: 0.6 });
    const signals: AgentSignal[] = [
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.8, weight: 0.15 },
      { agentName: 'PatternMatcher', direction: 'LONG', confidence: 0.75, weight: 0.12 },
      { agentName: 'OrderFlowAnalyst', direction: 'LONG', confidence: 0.7, weight: 0.10 },
      { agentName: 'LowConfAgent', direction: 'SHORT', confidence: 0.4, weight: 0.20 }, // Below 0.6 threshold
    ];

    const result = strictFilter.validateEntry(signals);
    
    expect(result.isValid).toBe(true);
    expect(result.conflictingAgents).toBe(0); // Low confidence agent excluded
  });

  it('should NOT filter agents with default production config (minConfidence=0.03)', () => {
    // Phase 28: Default config has very low confidence threshold
    const signals: AgentSignal[] = [
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.8, weight: 0.15 },
      { agentName: 'PatternMatcher', direction: 'LONG', confidence: 0.75, weight: 0.12 },
      { agentName: 'OrderFlowAnalyst', direction: 'LONG', confidence: 0.7, weight: 0.10 },
      { agentName: 'LowConfAgent', direction: 'SHORT', confidence: 0.4, weight: 0.20 },
    ];

    const result = filter.validateEntry(signals);
    
    expect(result.isValid).toBe(true);
    expect(result.conflictingAgents).toBe(1); // Agent NOT filtered with default config
  });

  it('should track conflicting agents', () => {
    const signals: AgentSignal[] = [
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.85, weight: 0.15 },
      { agentName: 'PatternMatcher', direction: 'LONG', confidence: 0.80, weight: 0.12 },
      { agentName: 'OrderFlowAnalyst', direction: 'LONG', confidence: 0.75, weight: 0.10 },
      { agentName: 'SentimentAnalyst', direction: 'SHORT', confidence: 0.7, weight: 0.08 },
    ];

    const result = filter.validateEntry(signals);
    
    expect(result.conflictingAgents).toBe(1);
    expect(result.breakdown.bearishAgents).toContain('SentimentAnalyst');
  });

  it('should handle SHORT direction consensus', () => {
    const signals: AgentSignal[] = [
      { agentName: 'TechnicalAnalyst', direction: 'SHORT', confidence: 0.8, weight: 0.15 },
      { agentName: 'PatternMatcher', direction: 'SHORT', confidence: 0.75, weight: 0.12 },
      { agentName: 'OrderFlowAnalyst', direction: 'SHORT', confidence: 0.7, weight: 0.10 },
    ];

    const result = filter.validateEntry(signals);
    
    expect(result.isValid).toBe(true);
    expect(result.direction).toBe('SHORT');
    expect(result.weightedScore).toBeLessThan(0);
  });
});

// ============================================
// Multi-Timeframe Alignment Tests
// ============================================
describe('MultiTimeframeAlignment', () => {
  let alignment: MultiTimeframeAlignment;

  beforeEach(() => {
    alignment = new MultiTimeframeAlignment();
  });

  it('should detect bullish trend from upward candles', () => {
    const candles = generateCandles(50, 100, 'up');
    const trend = alignment.calculateTrend(candles);
    
    expect(trend.direction).toBe('BULLISH');
    expect(trend.strength).toBeGreaterThan(0);
    expect(trend.ema20).toBeGreaterThan(trend.ema50);
  });

  it('should detect bearish trend from downward candles', () => {
    const candles = generateCandles(50, 100, 'down');
    const trend = alignment.calculateTrend(candles);
    
    expect(trend.direction).toBe('BEARISH');
    expect(trend.strength).toBeGreaterThan(0);
    expect(trend.ema20).toBeLessThan(trend.ema50);
  });

  it('should return neutral for flat/choppy market', () => {
    const candles = generateCandles(50, 100, 'flat');
    const trend = alignment.calculateTrend(candles);
    
    // Flat markets may still show slight direction, but strength should be low
    expect(trend.strength).toBeLessThan(0.5);
  });

  it('should check alignment across multiple timeframes', async () => {
    const candlesByTimeframe = new Map<string, Candle[]>();
    candlesByTimeframe.set('5m', generateCandles(50, 100, 'up'));
    candlesByTimeframe.set('15m', generateCandles(50, 100, 'up'));
    candlesByTimeframe.set('1h', generateCandles(50, 100, 'up'));
    candlesByTimeframe.set('4h', generateCandles(50, 100, 'up'));

    const result = await alignment.checkAlignment('BTC-USD', 'LONG', candlesByTimeframe);
    
    expect(result.isAligned).toBe(true);
    expect(result.alignedCount).toBeGreaterThanOrEqual(3);
    expect(result.timeframeBreakdown.length).toBe(4);
  });

  it('should reject alignment when timeframes disagree', async () => {
    const candlesByTimeframe = new Map<string, Candle[]>();
    candlesByTimeframe.set('5m', generateCandles(50, 100, 'up'));
    candlesByTimeframe.set('15m', generateCandles(50, 100, 'down')); // Required, disagrees
    candlesByTimeframe.set('1h', generateCandles(50, 100, 'down')); // Required, disagrees
    candlesByTimeframe.set('4h', generateCandles(50, 100, 'up'));

    const result = await alignment.checkAlignment('BTC-USD', 'LONG', candlesByTimeframe);
    
    expect(result.isAligned).toBe(false);
    expect(result.isAligned).toBe(false);
  });

  it('should handle insufficient candle data gracefully', async () => {
    const candlesByTimeframe = new Map<string, Candle[]>();
    candlesByTimeframe.set('5m', generateCandles(10, 100, 'up')); // Not enough candles

    const result = await alignment.checkAlignment('BTC-USD', 'LONG', candlesByTimeframe);
    
    expect(result.isAligned).toBe(false);
    expect(result.isAligned).toBe(false);
  });
});

// ============================================
// Volume Confirmation Tests
// ============================================
describe('VolumeConfirmation', () => {
  let volumeService: VolumeConfirmation;

  beforeEach(() => {
    volumeService = new VolumeConfirmation();
  });

  it('should validate when current volume exceeds threshold', async () => {
    const candles = generateCandles(21, 100, 'up', 1000);
    // Set last candle to high volume
    candles[candles.length - 1].volume = 2000; // 2x average

    const result = await volumeService.validateVolume('BTC-USD', '5m', candles);
    
    expect(result.isValid).toBe(true);
    expect(result.volumeRatio).toBeGreaterThan(1.5);
  });

  it('should reject when current volume is below threshold', async () => {
    const candles = generateCandles(21, 100, 'up', 1000);
    // Set last candle to low volume
    candles[candles.length - 1].volume = 500; // 0.5x average

    const result = await volumeService.validateVolume('BTC-USD', '5m', candles);
    
    expect(result.isValid).toBe(false);
    expect(result.volumeRatio).toBeLessThan(1.5);
    expect(result.reason).toContain('Volume too low');
  });

  it('should calculate percentile rank correctly', async () => {
    const candles = generateCandles(21, 100, 'up', 1000);
    // Set last candle to very high volume
    candles[candles.length - 1].volume = 5000; // Should be high percentile

    const result = await volumeService.validateVolume('BTC-USD', '5m', candles);
    
    expect(result.percentileRank).toBeGreaterThan(80);
  });

  it('should adjust threshold based on volatility', async () => {
    // High volatility candles
    const highVolCandles: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 21; i++) {
      price = price * (1 + (Math.random() - 0.5) * 0.1); // High volatility
      highVolCandles.push({
        timestamp: Date.now() - (21 - i) * 60000,
        open: price * 0.95,
        high: price * 1.05,
        low: price * 0.95,
        close: price,
        volume: 1000,
      });
    }
    highVolCandles[highVolCandles.length - 1].volume = 1400; // 1.4x average

    const result = await volumeService.validateVolume('BTC-USD', '5m', highVolCandles);
    
    // In high volatility, threshold is 1.3x, so 1.4x should pass
    expect(result.dynamicMultiplier).toBe(1.3);
    expect(result.isValid).toBe(true);
  });

  it('should handle insufficient data gracefully', async () => {
    const candles = generateCandles(5, 100, 'up', 1000); // Not enough candles

    const result = await volumeService.validateVolume('BTC-USD', '5m', candles);
    
    expect(result.isValid).toBe(false);
    expect(result.isValid).toBe(false);
  });
});

// ============================================
// Entry Validation Service Integration Tests
// ============================================
describe('EntryValidationService', () => {
  let service: EntryValidationService;

  beforeEach(() => {
    service = new EntryValidationService({ cooldownMinutes: 1 });
  });

  it('should validate entry when all conditions pass', async () => {
    const signals: AgentSignal[] = [
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.85, weight: 0.15 },
      { agentName: 'PatternMatcher', direction: 'LONG', confidence: 0.80, weight: 0.12 },
      { agentName: 'OrderFlowAnalyst', direction: 'LONG', confidence: 0.75, weight: 0.10 },
      { agentName: 'SentimentAnalyst', direction: 'LONG', confidence: 0.70, weight: 0.08 },
    ];

    const candlesByTimeframe = new Map<string, Candle[]>();
    const upCandles = generateCandles(50, 100, 'up', 1000);
    upCandles[upCandles.length - 1].volume = 2000; // High volume
    
    candlesByTimeframe.set('5m', upCandles);
    candlesByTimeframe.set('15m', generateCandles(50, 100, 'up'));
    candlesByTimeframe.set('1h', generateCandles(50, 100, 'up'));
    candlesByTimeframe.set('4h', generateCandles(50, 100, 'up'));

    const result = await service.validateEntry('BTC-USD', signals, candlesByTimeframe);
    
    expect(result.canEnter).toBe(true);
    expect(result.direction).toBe('LONG');
    expect(result.validations.agentConsensus).toBe(true);
    expect(result.validations.timeframeAlignment).toBe(true);
    expect(result.validations.volumeConfirmation).toBe(true);
  });

  it('should pass through with reduced confidence when agent consensus fails', async () => {
    // Phase 28: EntryValidationService now passes through with canEnter=true
    // but agentConsensus=false and reduced confidence (0.3)
    // This prevents cooldown infinite loops
    const signals: AgentSignal[] = [
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.8, weight: 0.15 },
      { agentName: 'PatternMatcher', direction: 'SHORT', confidence: 0.75, weight: 0.12 },
      { agentName: 'OrderFlowAnalyst', direction: 'NEUTRAL', confidence: 0.5, weight: 0.10 },
    ];

    const result = await service.validateEntry('BTC-USD', signals);
    
    // canEnter is true (passthrough) but agentConsensus is false
    expect(result.canEnter).toBe(true);
    expect(result.confidence).toBe(0.3);
    expect(result.validations.agentConsensus).toBe(false);
  });

  it('should pass through with reduced confidence on weak consensus (no cooldown loop)', async () => {
    // Phase 28: Weak consensus no longer triggers cooldown — it passes through
    // with reduced confidence to prevent infinite cooldown loops
    const signals: AgentSignal[] = [
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.5, weight: 0.15 },
    ];

    // First attempt — passes through with reduced confidence
    const result1 = await service.validateEntry('BTC-USD', signals);
    expect(result1.canEnter).toBe(true);
    expect(result1.confidence).toBe(0.3);
    
    // Second attempt — also passes through (no cooldown set)
    const result2 = await service.validateEntry('BTC-USD', signals);
    expect(result2.canEnter).toBe(true);
    expect(result2.confidence).toBe(0.3);
  });

  it('should allow entry after cooldown expires', async () => {
    // Use very short cooldown for test
    service.updateConfig({ cooldownMinutes: 0 });
    
    const signals: AgentSignal[] = [
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.5, weight: 0.15 },
    ];

    // First attempt fails
    await service.validateEntry('BTC-USD', signals);
    
    // Clear cooldown manually
    service.clearCooldown('BTC-USD');
    
    // Should not be blocked
    const result = await service.validateEntry('BTC-USD', signals);
    
    expect(result.reasons).not.toContain(expect.stringContaining('cooldown'));
  });

  it('should provide detailed validation breakdown', async () => {
    const signals: AgentSignal[] = [
      { agentName: 'TechnicalAnalyst', direction: 'LONG', confidence: 0.85, weight: 0.15 },
      { agentName: 'PatternMatcher', direction: 'LONG', confidence: 0.80, weight: 0.12 },
      { agentName: 'OrderFlowAnalyst', direction: 'LONG', confidence: 0.75, weight: 0.10 },
    ];

    const result = await service.validateEntry('BTC-USD', signals);
    
    expect(result.details.agentValidation).toBeDefined();
    expect(result.details.agentValidation.breakdown).toBeDefined();
    expect(result.details.agentValidation.breakdown.bullishAgents.length).toBe(3);
  });
});
