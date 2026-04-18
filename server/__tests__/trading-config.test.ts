/**
 * TradingConfig Unit Tests
 * 
 * Tests the centralized trading configuration module (Phase 17):
 * - PRODUCTION_CONFIG defaults and invariants
 * - getVolatilityRegime classification
 * - getRegimeAdjustedExits multiplier application
 * - validateConfig consistency checks
 * - get/set config singleton behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PRODUCTION_CONFIG,
  getTradingConfig,
  setTradingConfig,
  getVolatilityRegime,
  getRegimeAdjustedExits,
  validateConfig,
  TradingConfiguration,
} from '../config/TradingConfig';

describe('TradingConfig', () => {
  beforeEach(() => {
    // Reset to production config before each test
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  describe('PRODUCTION_CONFIG defaults', () => {
    it('should have valid circuit breaker defaults', () => {
      const cb = PRODUCTION_CONFIG.circuitBreakers;
      expect(cb.maxDailyTrades).toBe(50);
      expect(cb.maxConsecutiveLosses).toBe(4);
      expect(cb.maxDailyLossPercent).toBe(0.05);
      expect(cb.maxDrawdownPercent).toBe(0.15);
      expect(cb.maxSymbolConcentration).toBe(0.25);
    });

    it('should have valid position sizing defaults', () => {
      const ps = PRODUCTION_CONFIG.positionSizing;
      expect(ps.kellyFraction).toBe(0.25);
      expect(ps.maxPositionSizePercent).toBe(0.10);
      expect(ps.maxTotalExposurePercent).toBe(0.60);
      expect(ps.maxConcurrentPositions).toBe(5);
      expect(ps.maxPositionsPerSymbol).toBe(1);
    });

    it('should have valid VaR limits', () => {
      const vl = PRODUCTION_CONFIG.varLimits;
      expect(vl.enabled).toBe(true);
      expect(vl.maxPortfolioVaR95Percent).toBe(0.08);
      expect(vl.maxIncrementalVaR95Percent).toBe(0.02);
      expect(vl.maxPortfolioCVaR95Percent).toBe(0.12);
      expect(vl.minHistoricalDataPoints).toBe(30);
      expect(vl.varConfidenceLevel).toBe(0.95);
    });

    it('should have valid correlation limits', () => {
      const corr = PRODUCTION_CONFIG.correlation;
      expect(corr.correlationThreshold).toBe(0.70);
      expect(corr.highCorrelationSizeReduction).toBe(0.70);
      expect(corr.veryHighCorrelationSizeReduction).toBe(0.50);
      expect(corr.blockIfCorrelationAbove).toBe(0.95);
    });

    it('should have valid consensus thresholds', () => {
      const cons = PRODUCTION_CONFIG.consensus;
      // Phase 44: Updated to match current production values
      expect(cons.minConsensusStrength).toBe(0.50);
      expect(cons.minConfidence).toBe(0.45);
      expect(cons.minAgentAgreement).toBe(3);
      expect(cons.minDirectionRatio).toBe(0.60);
    });

    it('should have valid exit parameters', () => {
      const exits = PRODUCTION_CONFIG.exits;
      // Phase 44: hardStopLossPercent tightened from -1.0 to -0.8 in Phase 40
      expect(exits.hardStopLossPercent).toBe(-0.8);
      expect(exits.maxLoserTimeMinutes).toBe(12);
      expect(exits.maxWinnerTimeMinutes).toBe(120);
      expect(exits.profitTargets).toEqual([0.5, 1.5, 3.0]);
      expect(exits.targetExitPercents).toEqual([33, 33, 34]);
    });

    it('should have regime adjustments for all three volatility regimes', () => {
      const ra = PRODUCTION_CONFIG.exits.regimeAdjustments;
      expect(ra.lowVol.stopLossMultiplier).toBe(1.5);
      expect(ra.normalVol.stopLossMultiplier).toBe(1.0);
      expect(ra.highVol.stopLossMultiplier).toBe(0.5);
    });
  });

  describe('getVolatilityRegime', () => {
    it('should return normalVol for undefined ATR', () => {
      expect(getVolatilityRegime(undefined)).toBe('normalVol');
    });

    it('should return normalVol for zero ATR', () => {
      expect(getVolatilityRegime(0)).toBe('normalVol');
    });

    it('should return normalVol for negative ATR', () => {
      expect(getVolatilityRegime(-1)).toBe('normalVol');
    });

    it('should return lowVol for ATR < 1.5%', () => {
      expect(getVolatilityRegime(0.5)).toBe('lowVol');
      expect(getVolatilityRegime(1.0)).toBe('lowVol');
      expect(getVolatilityRegime(1.49)).toBe('lowVol');
    });

    it('should return normalVol for ATR between 1.5% and 4.0%', () => {
      expect(getVolatilityRegime(1.5)).toBe('normalVol');
      expect(getVolatilityRegime(2.5)).toBe('normalVol');
      expect(getVolatilityRegime(4.0)).toBe('normalVol');
    });

    it('should return highVol for ATR > 4.0%', () => {
      expect(getVolatilityRegime(4.01)).toBe('highVol');
      expect(getVolatilityRegime(8.0)).toBe('highVol');
      expect(getVolatilityRegime(15.0)).toBe('highVol');
    });
  });

  describe('getRegimeAdjustedExits', () => {
    it('should return base parameters for normalVol (multiplier 1.0)', () => {
      const exits = getRegimeAdjustedExits(2.5);
      // Phase 44: base hardStopLossPercent is -0.8 (Phase 40 change)
      expect(exits.hardStopLossPercent).toBe(-0.8);
      expect(exits.maxLoserTimeMinutes).toBe(12);
      expect(exits.atrStopMultiplier).toBe(1.5);
    });

    it('should widen stops for lowVol regime', () => {
      const exits = getRegimeAdjustedExits(0.5);
      // lowVol: stopLossMultiplier = 1.5, so -0.8 * 1.5 = -1.2
      expect(exits.hardStopLossPercent).toBeCloseTo(-1.2, 1);
      // lowVol: maxHoldTimeMultiplier = 1.3, so 12 * 1.3 = 15.6
      expect(exits.maxLoserTimeMinutes).toBeCloseTo(15.6, 1);
      expect(exits.atrStopMultiplier).toBe(1.8);
    });

    it('should tighten stops for highVol regime', () => {
      const exits = getRegimeAdjustedExits(6.0);
      // highVol: stopLossMultiplier = 0.5, so -0.8 * 0.5 = -0.4
      expect(exits.hardStopLossPercent).toBeCloseTo(-0.4, 1);
      // highVol: maxHoldTimeMultiplier = 0.7, so 12 * 0.7 = 8.4
      expect(exits.maxLoserTimeMinutes).toBeCloseTo(8.4, 1);
      expect(exits.atrStopMultiplier).toBe(1.2);
    });

    it('should use normalVol for undefined ATR', () => {
      const exits = getRegimeAdjustedExits(undefined);
      expect(exits.hardStopLossPercent).toBe(-0.8);
      expect(exits.maxLoserTimeMinutes).toBe(12);
    });
  });

  describe('validateConfig', () => {
    it('should return no errors for PRODUCTION_CONFIG', () => {
      const errors = validateConfig(PRODUCTION_CONFIG);
      expect(errors).toEqual([]);
    });

    it('should detect maxPositionSize > maxSymbolConcentration', () => {
      const bad: TradingConfiguration = {
        ...PRODUCTION_CONFIG,
        positionSizing: {
          ...PRODUCTION_CONFIG.positionSizing,
          maxPositionSizePercent: 0.30,  // > 0.25 symbol concentration
        },
      };
      const errors = validateConfig(bad);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('maxPositionSize');
    });

    it('should detect positive hardStopLossPercent', () => {
      const bad: TradingConfiguration = {
        ...PRODUCTION_CONFIG,
        exits: {
          ...PRODUCTION_CONFIG.exits,
          hardStopLossPercent: 1.0,  // Should be negative
        },
      };
      const errors = validateConfig(bad);
      expect(errors.some(e => e.includes('hardStopLossPercent'))).toBe(true);
    });

    it('should detect incrementalVaR >= portfolioVaR', () => {
      const bad: TradingConfiguration = {
        ...PRODUCTION_CONFIG,
        varLimits: {
          ...PRODUCTION_CONFIG.varLimits,
          maxIncrementalVaR95Percent: 0.10,  // >= 0.08 portfolio VaR
        },
      };
      const errors = validateConfig(bad);
      expect(errors.some(e => e.includes('incrementalVaR'))).toBe(true);
    });
  });

  describe('get/set config singleton', () => {
    it('should return production config by default', () => {
      const config = getTradingConfig();
      expect(config.circuitBreakers.maxDailyTrades).toBe(50);
    });

    it('should allow overriding config', () => {
      const custom: TradingConfiguration = {
        ...PRODUCTION_CONFIG,
        circuitBreakers: {
          ...PRODUCTION_CONFIG.circuitBreakers,
          maxDailyTrades: 100,
        },
      };
      setTradingConfig(custom);
      expect(getTradingConfig().circuitBreakers.maxDailyTrades).toBe(100);
    });

    it('should persist overridden config across calls', () => {
      const custom: TradingConfiguration = {
        ...PRODUCTION_CONFIG,
        consensus: {
          ...PRODUCTION_CONFIG.consensus,
          minConsensusStrength: 0.80,
        },
      };
      setTradingConfig(custom);
      expect(getTradingConfig().consensus.minConsensusStrength).toBe(0.80);
      expect(getTradingConfig().consensus.minConsensusStrength).toBe(0.80);
    });
  });
});
