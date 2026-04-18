/**
 * Week 9 Risk Management Tests
 * 
 * Comprehensive tests for:
 * - Kelly Criterion position sizing
 * - Circuit breakers for consecutive losses
 * - Correlation-based position limits
 * - EnhancedTradeExecutor integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Week9RiskManager,
  KellyCriterionCalculator,
  CircuitBreaker,
  CorrelationManager,
  TradeResult,
  RiskManagerConfig,
} from '../services/Week9RiskManager';

// ============================================================================
// KELLY CRITERION CALCULATOR TESTS
// ============================================================================

describe('KellyCriterionCalculator', () => {
  let calculator: KellyCriterionCalculator;
  const defaultConfig: RiskManagerConfig = {
    kellyFraction: 0.25,
    minWinRate: 0.40,
    defaultWinRate: 0.50,
    defaultPayoffRatio: 1.5,
    maxConsecutiveLosses: 3,
    maxGlobalConsecutiveLosses: 5,
    cooldownMinutes: 30,
    maxCorrelatedExposure: 0.30,
    correlationThreshold: 0.70,
    maxPositionSize: 0.20,
    maxTotalExposure: 0.80,
    maxPositionsPerSymbol: 1,
    maxTotalPositions: 10,
  };

  beforeEach(() => {
    calculator = new KellyCriterionCalculator(defaultConfig);
  });

  describe('calculatePositionSize', () => {
    it('should use default values when no trade history', () => {
      const result = calculator.calculatePositionSize(10000);
      
      // With default 50% win rate and 1.5 payoff ratio:
      // Kelly = (1.5 * 0.5 - 0.5) / 1.5 = (0.75 - 0.5) / 1.5 = 0.1667
      // Fractional Kelly = 0.1667 * 0.25 = 0.0417
      expect(result.kellyFraction).toBeCloseTo(0.1667, 2);
      expect(result.adjustedFraction).toBeCloseTo(0.0417, 2);
      expect(result.recommendedSize).toBeCloseTo(416.67, 0);
    });

    it('should calculate Kelly correctly with winning trade history', () => {
      // Add 10 winning trades (60% win rate, 2:1 payoff)
      for (let i = 0; i < 6; i++) {
        calculator.addTradeResult(createTradeResult(2.0)); // 2% win
      }
      for (let i = 0; i < 4; i++) {
        calculator.addTradeResult(createTradeResult(-1.0)); // 1% loss
      }

      const result = calculator.calculatePositionSize(10000);
      
      // Win rate = 60%, Avg win = 2%, Avg loss = 1%, Payoff = 2
      // Kelly = (2 * 0.6 - 0.4) / 2 = (1.2 - 0.4) / 2 = 0.4
      expect(result.kellyFraction).toBeCloseTo(0.4, 1);
      expect(result.recommendedSize).toBeGreaterThan(0);
    });

    it('should return zero for negative Kelly', () => {
      // Add losing trades (30% win rate, 1:1 payoff)
      for (let i = 0; i < 3; i++) {
        calculator.addTradeResult(createTradeResult(1.0)); // 1% win
      }
      for (let i = 0; i < 7; i++) {
        calculator.addTradeResult(createTradeResult(-1.0)); // 1% loss
      }

      const result = calculator.calculatePositionSize(10000);
      
      // Win rate = 30%, Payoff = 1
      // Kelly = (1 * 0.3 - 0.7) / 1 = -0.4 (negative)
      expect(result.recommendedSize).toBe(0);
      expect(result.reason).toContain('Negative Kelly');
    });

    it('should cap at max position size', () => {
      // Add very profitable trades to get high Kelly
      for (let i = 0; i < 8; i++) {
        calculator.addTradeResult(createTradeResult(5.0)); // 5% win
      }
      for (let i = 0; i < 2; i++) {
        calculator.addTradeResult(createTradeResult(-1.0)); // 1% loss
      }

      const result = calculator.calculatePositionSize(10000);
      
      // Even with high Kelly, should be capped at 20%
      expect(result.adjustedFraction).toBeLessThanOrEqual(0.20);
      expect(result.recommendedSize).toBeLessThanOrEqual(2000);
    });

    it('should calculate symbol-specific Kelly', () => {
      // Add trades for BTC-USD
      for (let i = 0; i < 5; i++) {
        calculator.addTradeResult(createTradeResult(2.0, 'BTC-USD'));
      }
      for (let i = 0; i < 5; i++) {
        calculator.addTradeResult(createTradeResult(-1.0, 'BTC-USD'));
      }

      // Add trades for ETH-USD with different performance
      for (let i = 0; i < 3; i++) {
        calculator.addTradeResult(createTradeResult(1.0, 'ETH-USD'));
      }
      for (let i = 0; i < 7; i++) {
        calculator.addTradeResult(createTradeResult(-1.0, 'ETH-USD'));
      }

      const btcResult = calculator.calculatePositionSize(10000, 'BTC-USD');
      const ethResult = calculator.calculatePositionSize(10000, 'ETH-USD');
      
      // BTC should have higher Kelly (50% win rate, 2:1 payoff)
      // ETH should have lower/negative Kelly (30% win rate, 1:1 payoff)
      expect(btcResult.recommendedSize).toBeGreaterThan(ethResult.recommendedSize);
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', () => {
      // Add mixed trades
      for (let i = 0; i < 6; i++) {
        calculator.addTradeResult(createTradeResult(2.0));
      }
      for (let i = 0; i < 4; i++) {
        calculator.addTradeResult(createTradeResult(-1.0));
      }

      const stats = calculator.getStatistics();
      
      expect(stats.totalTrades).toBe(10);
      expect(stats.winRate).toBeCloseTo(0.6, 2);
      expect(stats.avgWin).toBeCloseTo(2.0, 2);
      expect(stats.avgLoss).toBeCloseTo(1.0, 2);
      expect(stats.payoffRatio).toBeCloseTo(2.0, 2);
    });

    it('should calculate profit factor correctly', () => {
      calculator.addTradeResult(createTradeResult(3.0));
      calculator.addTradeResult(createTradeResult(2.0));
      calculator.addTradeResult(createTradeResult(-1.0));
      calculator.addTradeResult(createTradeResult(-1.0));

      const stats = calculator.getStatistics();
      
      // Total wins = 5%, Total losses = 2%
      // Profit factor = 5 / 2 = 2.5
      expect(stats.profitFactor).toBeCloseTo(2.5, 2);
    });
  });
});

// ============================================================================
// CIRCUIT BREAKER TESTS
// ============================================================================

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;
  const defaultConfig: RiskManagerConfig = {
    kellyFraction: 0.25,
    minWinRate: 0.40,
    defaultWinRate: 0.50,
    defaultPayoffRatio: 1.5,
    maxConsecutiveLosses: 3,
    maxGlobalConsecutiveLosses: 5,
    cooldownMinutes: 30,
    maxCorrelatedExposure: 0.30,
    correlationThreshold: 0.70,
    maxPositionSize: 0.20,
    maxTotalExposure: 0.80,
    maxPositionsPerSymbol: 1,
    maxTotalPositions: 10,
  };

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker(defaultConfig);
  });

  describe('recordTrade', () => {
    it('should track consecutive losses per symbol', () => {
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));

      const status = circuitBreaker.checkStatus('BTC-USD');
      expect(status.consecutiveLosses).toBe(2);
      expect(status.isTripped).toBe(false);
    });

    it('should trip after max consecutive losses', () => {
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));

      const status = circuitBreaker.checkStatus('BTC-USD');
      expect(status.isTripped).toBe(true);
      expect(status.consecutiveLosses).toBe(3);
      expect(status.cooldownUntil).not.toBeNull();
    });

    it('should reset consecutive losses on win', () => {
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      circuitBreaker.recordTrade(createTradeResult(1.0, 'BTC-USD')); // Win

      const status = circuitBreaker.checkStatus('BTC-USD');
      expect(status.consecutiveLosses).toBe(0);
      expect(status.isTripped).toBe(false);
    });

    it('should track global consecutive losses', () => {
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'ETH-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'SOL-USD'));

      const status = circuitBreaker.checkStatus('BTC-USD');
      expect(status.globalConsecutiveLosses).toBe(3);
    });

    it('should trip global circuit breaker', () => {
      // 5 consecutive losses across different symbols
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'ETH-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'SOL-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'DOGE-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'LINK-USD'));

      const status = circuitBreaker.checkStatus('NEW-USD');
      expect(status.isTripped).toBe(true);
      expect(status.reason).toContain('Global');
    });

    it('should isolate symbol-specific losses', () => {
      // BTC has losses, ETH has wins
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      circuitBreaker.recordTrade(createTradeResult(1.0, 'ETH-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      circuitBreaker.recordTrade(createTradeResult(1.0, 'ETH-USD'));

      const btcStatus = circuitBreaker.checkStatus('BTC-USD');
      const ethStatus = circuitBreaker.checkStatus('ETH-USD');

      expect(btcStatus.consecutiveLosses).toBe(2);
      expect(ethStatus.consecutiveLosses).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset symbol-specific state', () => {
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));

      circuitBreaker.reset('BTC-USD');

      const status = circuitBreaker.checkStatus('BTC-USD');
      expect(status.isTripped).toBe(false);
      expect(status.consecutiveLosses).toBe(0);
    });

    it('should reset all state', () => {
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'ETH-USD'));
      circuitBreaker.recordTrade(createTradeResult(-1.0, 'SOL-USD'));

      circuitBreaker.reset();

      const btcStatus = circuitBreaker.checkStatus('BTC-USD');
      const ethStatus = circuitBreaker.checkStatus('ETH-USD');

      expect(btcStatus.consecutiveLosses).toBe(0);
      expect(ethStatus.consecutiveLosses).toBe(0);
      expect(btcStatus.globalConsecutiveLosses).toBe(0);
    });
  });
});

// ============================================================================
// CORRELATION MANAGER TESTS
// ============================================================================

describe('CorrelationManager', () => {
  let correlationManager: CorrelationManager;
  const defaultConfig: RiskManagerConfig = {
    kellyFraction: 0.25,
    minWinRate: 0.40,
    defaultWinRate: 0.50,
    defaultPayoffRatio: 1.5,
    maxConsecutiveLosses: 3,
    maxGlobalConsecutiveLosses: 5,
    cooldownMinutes: 30,
    maxCorrelatedExposure: 0.30,
    correlationThreshold: 0.70,
    maxPositionSize: 0.20,
    maxTotalExposure: 0.80,
    maxPositionsPerSymbol: 1,
    maxTotalPositions: 10,
  };

  beforeEach(() => {
    correlationManager = new CorrelationManager(defaultConfig);
  });

  describe('checkCorrelationLimit', () => {
    it('should allow position when no correlated exposure', () => {
      const result = correlationManager.checkCorrelationLimit('BTC-USD', 1000, 10000);
      
      expect(result.canOpenPosition).toBe(true);
      expect(result.totalExposure).toBe(1000);
    });

    it('should detect correlated symbols in same group', () => {
      // Register BTC position
      correlationManager.registerPosition('BTC-USD', 2000, 'long');

      // Check if we can open ETH (both in LARGE_CAP group)
      const result = correlationManager.checkCorrelationLimit('ETH-USD', 1000, 10000);
      
      // Total exposure would be 3000 (30% of 10000)
      expect(result.correlatedSymbols).toContain('BTC-USD');
      expect(result.totalExposure).toBe(3000);
    });

    it('should block position when correlated exposure exceeds limit', () => {
      // Register large BTC position
      correlationManager.registerPosition('BTC-USD', 2500, 'long');

      // Try to open ETH position that would exceed 30% limit
      const result = correlationManager.checkCorrelationLimit('ETH-USD', 1000, 10000);
      
      // Total would be 3500 (35% of 10000) > 30% limit
      expect(result.canOpenPosition).toBe(false);
      expect(result.reason).toContain('exceeds');
    });

    it('should allow uncorrelated positions', () => {
      // Register MEME coin position
      correlationManager.registerPosition('DOGE-USD', 2000, 'long');

      // Check DEFI coin (different group)
      const result = correlationManager.checkCorrelationLimit('AAVE-USD', 1000, 10000);
      
      expect(result.canOpenPosition).toBe(true);
      expect(result.correlatedSymbols).not.toContain('DOGE-USD');
    });

    it('should handle multiple correlated positions', () => {
      // Register multiple LARGE_CAP positions
      correlationManager.registerPosition('BTC-USD', 1000, 'long');
      correlationManager.registerPosition('ETH-USD', 1000, 'long');

      // Check SOL (also LARGE_CAP)
      const result = correlationManager.checkCorrelationLimit('SOL-USD', 500, 10000);
      
      // Total would be 2500 (25% of 10000)
      expect(result.totalExposure).toBe(2500);
      expect(result.canOpenPosition).toBe(true);
    });
  });

  describe('getExposureByGroup', () => {
    it('should calculate exposure by correlation group', () => {
      correlationManager.registerPosition('BTC-USD', 1000, 'long');
      correlationManager.registerPosition('ETH-USD', 500, 'long');
      correlationManager.registerPosition('DOGE-USD', 200, 'long');

      const exposure = correlationManager.getExposureByGroup();
      
      const largeCap = exposure.get('LARGE_CAP');
      const meme = exposure.get('MEME');

      expect(largeCap?.exposure).toBe(1500);
      expect(largeCap?.symbols).toContain('BTC-USD');
      expect(largeCap?.symbols).toContain('ETH-USD');
      expect(meme?.exposure).toBe(200);
    });
  });
});

// ============================================================================
// WEEK 9 RISK MANAGER INTEGRATION TESTS
// ============================================================================

describe('Week9RiskManager', () => {
  let riskManager: Week9RiskManager;

  beforeEach(() => {
    riskManager = new Week9RiskManager({
      kellyFraction: 0.25,
      maxConsecutiveLosses: 3,
      maxGlobalConsecutiveLosses: 5,
      cooldownMinutes: 30,
      maxCorrelatedExposure: 0.30,
    });
  });

  describe('calculatePositionSize', () => {
    it('should pass all checks for valid trade', () => {
      const result = riskManager.calculatePositionSize(
        'BTC-USD',
        10000,  // available capital
        10000,  // portfolio value
        0.8     // 80% confidence
      );

      expect(result.canTrade).toBe(true);
      expect(result.positionSize).toBeGreaterThan(0);
      expect(result.circuitBreakerStatus.isTripped).toBe(false);
      expect(result.correlationLimit.canOpenPosition).toBe(true);
    });

    it('should block trade when circuit breaker is tripped', () => {
      // Trip the circuit breaker
      riskManager.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      riskManager.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      riskManager.recordTrade(createTradeResult(-1.0, 'BTC-USD'));

      const result = riskManager.calculatePositionSize('BTC-USD', 10000, 10000);

      expect(result.canTrade).toBe(false);
      expect(result.circuitBreakerStatus.isTripped).toBe(true);
    });

    it('should block trade when correlation limit exceeded', () => {
      // Register large correlated position
      riskManager.registerPosition('BTC-USD', 3000, 'long');

      const result = riskManager.calculatePositionSize('ETH-USD', 10000, 10000);

      // ETH is correlated with BTC in LARGE_CAP group
      // Adding more would exceed 30% limit
      expect(result.canTrade).toBe(false);
      expect(result.correlationLimit.canOpenPosition).toBe(false);
    });

    it('should adjust position size by confidence', () => {
      const highConfidence = riskManager.calculatePositionSize('BTC-USD', 10000, 10000, 1.0);
      const lowConfidence = riskManager.calculatePositionSize('BTC-USD', 10000, 10000, 0.5);

      expect(highConfidence.positionSize).toBeGreaterThan(lowConfidence.positionSize);
    });

    it('should improve Kelly with winning trades', () => {
      // Initial position size
      const initial = riskManager.calculatePositionSize('BTC-USD', 10000, 10000);

      // Add winning trades
      for (let i = 0; i < 10; i++) {
        riskManager.recordTrade(createTradeResult(2.0, 'BTC-USD'));
      }

      // Position size should increase with better track record
      const afterWins = riskManager.calculatePositionSize('BTC-USD', 10000, 10000);

      expect(afterWins.kellyResult.kellyFraction).toBeGreaterThan(initial.kellyResult.kellyFraction);
    });
  });

  describe('recordTrade', () => {
    it('should update Kelly calculator and circuit breaker', () => {
      riskManager.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      riskManager.recordTrade(createTradeResult(-1.0, 'BTC-USD'));

      const status = riskManager.getRiskStatus();
      expect(status.activeCooldowns.length).toBe(0); // Not yet tripped

      riskManager.recordTrade(createTradeResult(-1.0, 'BTC-USD'));

      const statusAfter = riskManager.getRiskStatus();
      expect(statusAfter.activeCooldowns.length).toBe(1); // Now tripped
    });
  });

  describe('getRiskStatus', () => {
    it('should return comprehensive status', () => {
      // Add some trades
      riskManager.recordTrade(createTradeResult(2.0, 'BTC-USD'));
      riskManager.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      riskManager.registerPosition('ETH-USD', 1000, 'long');

      const status = riskManager.getRiskStatus();

      expect(status.kellyStats.totalTrades).toBe(2);
      expect(status.correlationExposure.size).toBeGreaterThan(0);
      expect(status.config).toBeDefined();
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      // Add trades and positions
      riskManager.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      riskManager.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      riskManager.recordTrade(createTradeResult(-1.0, 'BTC-USD'));
      riskManager.registerPosition('ETH-USD', 1000, 'long');

      riskManager.reset();

      const result = riskManager.calculatePositionSize('BTC-USD', 10000, 10000);
      expect(result.canTrade).toBe(true);
      expect(result.circuitBreakerStatus.isTripped).toBe(false);
    });
  });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createTradeResult(pnlPercent: number, symbol: string = 'BTC-USD'): TradeResult {
  return {
    symbol,
    direction: 'long',
    entryPrice: 50000,
    exitPrice: 50000 * (1 + pnlPercent / 100),
    pnlPercent,
    pnlAbsolute: 1000 * (pnlPercent / 100),
    timestamp: Date.now(),
    holdTimeMs: 3600000, // 1 hour
  };
}
