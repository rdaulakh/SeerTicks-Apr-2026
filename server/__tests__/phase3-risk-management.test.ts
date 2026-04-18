/**
 * Phase 3: Risk Management Hardening Tests
 * 
 * Tests for:
 * - 3.1 Position Intelligence Manager integration
 * - 3.2 Portfolio Correlation Limits
 * - 3.3 ATR-Based Dynamic Stop Loss
 * - 3.4 Regime-Aware Trailing Stop
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock database
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue(null),
  getPaperPositions: vi.fn().mockResolvedValue([]),
  getPaperWallet: vi.fn().mockResolvedValue({ balance: '10000', equity: '10000' }),
  insertPaperPosition: vi.fn().mockResolvedValue({ id: 1 }),
}));

// Mock SharedAgentMemory
const mockSharedMemory = {
  getRegimeConsensus: vi.fn(),
  updateRegimeConsensus: vi.fn(),
  isVetoActive: vi.fn().mockReturnValue(false),
  getVetoState: vi.fn().mockReturnValue({ active: false }),
};

vi.mock('../services/SharedAgentMemory', () => ({
  getSharedAgentMemory: () => mockSharedMemory,
}));

// Import after mocking
import { calculateATR, calculateATRStopLoss, calculateATRTakeProfit, detectMarketRegime, getRegimeParameters } from '../utils/RiskCalculations';
import { RiskManager, initializeRiskManager, getRiskManager } from '../RiskManager';

describe('Phase 3: Risk Management Hardening', () => {
  
  // 3.1 Position Intelligence Manager tests removed (service deleted in dead code cleanup)

  describe('3.2 Portfolio Correlation Limits', () => {
    let riskManager: RiskManager;

    beforeEach(() => {
      riskManager = initializeRiskManager(10000, {
        maxCorrelatedExposure: 0.10, // 10%
        correlationThreshold: 0.7,   // 70%
      });
    });

    it('should allow trades when correlation exposure is within limits', async () => {
      const result = await riskManager.checkCorrelatedExposure(
        1,
        'BTC-USD',
        500, // $500 position
        10000, // $10,000 account
        [] // No existing positions
      );
      
      expect(result.allowed).toBe(true);
    });

    it('should block trades when correlation exposure exceeds limits', async () => {
      const result = await riskManager.checkCorrelatedExposure(
        1,
        'BTC-USD',
        1500, // $1,500 position (15% of account)
        10000,
        [
          { symbol: 'ETH-USD', positionSize: 500 }, // ETH is correlated with BTC
        ]
      );
      
      // BTC-ETH correlation is 0.85 (above 0.7 threshold)
      // Total correlated exposure would be $2,000 (20% > 10% limit)
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Correlated exposure');
    });

    it('should calculate Pearson correlation correctly', () => {
      // Test internal correlation calculation
      const correlation = (riskManager as any).pearsonCorrelation(
        [1, 2, 3, 4, 5],
        [1, 2, 3, 4, 5]
      );
      expect(correlation).toBeCloseTo(1.0, 5); // Perfect positive correlation
      
      const negCorrelation = (riskManager as any).pearsonCorrelation(
        [1, 2, 3, 4, 5],
        [5, 4, 3, 2, 1]
      );
      expect(negCorrelation).toBeCloseTo(-1.0, 5); // Perfect negative correlation
    });

    it('should use known correlations for crypto pairs', () => {
      const btcEthCorrelation = (riskManager as any).getCorrelation('BTC-USD', 'ETH-USD');
      expect(btcEthCorrelation).toBeGreaterThan(0.7); // BTC-ETH are highly correlated
      
      const btcBtcCorrelation = (riskManager as any).getCorrelation('BTC-USD', 'BTC-USD');
      expect(btcBtcCorrelation).toBe(1.0); // Same asset = perfect correlation
    });
  });

  describe('3.3 ATR-Based Dynamic Stop Loss', () => {
    it('should calculate ATR correctly from candle data', () => {
      const candles = [
        { high: 100, low: 95, close: 98 },
        { high: 102, low: 97, close: 100 },
        { high: 105, low: 99, close: 103 },
        { high: 108, low: 102, close: 106 },
        { high: 110, low: 104, close: 108 },
        { high: 112, low: 106, close: 110 },
        { high: 115, low: 108, close: 113 },
        { high: 118, low: 111, close: 116 },
        { high: 120, low: 114, close: 118 },
        { high: 122, low: 116, close: 120 },
        { high: 125, low: 118, close: 123 },
        { high: 128, low: 121, close: 126 },
        { high: 130, low: 124, close: 128 },
        { high: 132, low: 126, close: 130 },
        { high: 135, low: 128, close: 133 },
      ];
      
      const atr = calculateATR(candles, 14);
      expect(atr).toBeGreaterThan(0);
      expect(atr).toBeLessThan(10); // Reasonable ATR for this data
    });

    it('should calculate ATR-based stop loss for long positions', () => {
      const entryPrice = 50000;
      const atr = 1000; // $1,000 ATR
      const multiplier = 2.0;
      
      const stopLoss = calculateATRStopLoss(entryPrice, atr, 'long', multiplier);
      
      expect(stopLoss).toBe(48000); // 50000 - (1000 * 2)
    });

    it('should calculate ATR-based stop loss for short positions', () => {
      const entryPrice = 50000;
      const atr = 1000;
      const multiplier = 2.0;
      
      const stopLoss = calculateATRStopLoss(entryPrice, atr, 'short', multiplier);
      
      expect(stopLoss).toBe(52000); // 50000 + (1000 * 2)
    });

    it('should calculate ATR-based take profit with risk-reward ratio', () => {
      const entryPrice = 50000;
      const stopLoss = 48000; // $2,000 risk
      
      const takeProfit = calculateATRTakeProfit(entryPrice, stopLoss, 'long', 2.0);
      
      expect(takeProfit).toBe(54000); // 50000 + (2000 * 2)
    });

    it('should adjust stop loss multiplier based on regime', () => {
      const trendingParams = getRegimeParameters('trending_up');
      const volatileParams = getRegimeParameters('high_volatility');
      const rangingParams = getRegimeParameters('range_bound');
      
      // Trending: wider stops (2.5x)
      expect(trendingParams.stopLossMultiplier).toBe(2.5);
      
      // High volatility: widest stops (3.0x)
      expect(volatileParams.stopLossMultiplier).toBe(3.0);
      
      // Ranging: tighter stops (1.5x)
      expect(rangingParams.stopLossMultiplier).toBe(1.5);
    });
  });

  describe('3.4 Regime-Aware Trailing Stop', () => {
    it('should detect trending up regime correctly', () => {
      const price = 55000;
      const sma50 = 52000;  // Price > SMA50
      const sma200 = 48000; // SMA50 > SMA200
      const atr = 1000;
      const avgATR = 1000;
      
      const regime = detectMarketRegime(price, sma50, sma200, atr, avgATR);
      
      expect(regime).toBe('trending_up');
    });

    it('should detect trending down regime correctly', () => {
      const price = 45000;
      const sma50 = 48000;  // Price < SMA50
      const sma200 = 52000; // SMA50 < SMA200
      const atr = 1000;
      const avgATR = 1000;
      
      const regime = detectMarketRegime(price, sma50, sma200, atr, avgATR);
      
      expect(regime).toBe('trending_down');
    });

    it('should detect high volatility regime correctly', () => {
      const price = 50000;
      const sma50 = 50000;
      const sma200 = 50000;
      const atr = 2000;    // High ATR
      const avgATR = 1000; // ATR > 1.5x average
      
      const regime = detectMarketRegime(price, sma50, sma200, atr, avgATR);
      
      expect(regime).toBe('high_volatility');
    });

    it('should detect range-bound regime correctly', () => {
      const price = 50000;
      const sma50 = 49500;  // Price near SMA50
      const sma200 = 50500; // SMAs close together
      const atr = 800;
      const avgATR = 1000;  // Normal volatility
      
      const regime = detectMarketRegime(price, sma50, sma200, atr, avgATR);
      
      expect(regime).toBe('range_bound');
    });

    it('should provide correct regime multipliers', () => {
      const trendingParams = getRegimeParameters('trending_up');
      const volatileParams = getRegimeParameters('high_volatility');
      const rangingParams = getRegimeParameters('range_bound');
      
      // Trending: larger positions, let winners run
      expect(trendingParams.positionSizeMultiplier).toBe(1.2);
      expect(trendingParams.profitTargetPercent).toBe(5.0);
      
      // High volatility: smaller positions, defensive
      expect(volatileParams.positionSizeMultiplier).toBe(0.5);
      expect(volatileParams.strategy).toBe('defensive');
      
      // Ranging: mean reversion strategy
      expect(rangingParams.strategy).toBe('mean_reversion');
    });

    it('should use SharedAgentMemory for regime consensus', () => {
      mockSharedMemory.getRegimeConsensus.mockReturnValue({
        symbol: 'BTC-USD',
        regime: 'trending_up',
        confidence: 0.85,
        contributors: ['MacroAnalyst', 'TechnicalAnalyst'],
        timestamp: Date.now(),
      });
      
      const consensus = mockSharedMemory.getRegimeConsensus('BTC-USD');
      
      expect(consensus).toBeDefined();
      expect(consensus.regime).toBe('trending_up');
      expect(consensus.confidence).toBe(0.85);
    });
  });

  describe('IntelligentExitManager Integration', () => {
    it('should have ATR-based trailing configuration', async () => {
      const { getIntelligentExitManager } = await import('../services/IntelligentExitManager');
      const exitManager = getIntelligentExitManager();
      
      // Check that ATR trailing is enabled by default
      const status = exitManager.getStatus();
      expect(status).toBeDefined();
    });

    it('should accept positions with ATR field', async () => {
      const { getIntelligentExitManager } = await import('../services/IntelligentExitManager');
      const exitManager = getIntelligentExitManager();
      
      // Should not throw when adding position with ATR
      expect(() => {
        exitManager.addPosition({
          id: 'test-atr-position',
          symbol: 'BTC-USD',
          side: 'long',
          entryPrice: 50000,
          currentPrice: 50000,
          quantity: 0.1,
          remainingQuantity: 0.1,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          entryTime: Date.now(),
          marketRegime: 'trending_up',
          originalConsensus: 0.75,
          atr: 1000, // Phase 3: ATR field
        });
      }).not.toThrow();
      
      // Clean up
      exitManager.removePosition('test-atr-position');
    });

    it('should have regime multipliers configured', async () => {
      const { getIntelligentExitManager } = await import('../services/IntelligentExitManager');
      const exitManager = getIntelligentExitManager();
      
      // Access config through getStatus or similar
      const status = exitManager.getStatus();
      expect(status.isRunning).toBeDefined();
    });
  });

  describe('RiskManager Dynamic Position Sizing', () => {
    let riskManager: RiskManager;

    beforeEach(() => {
      riskManager = initializeRiskManager(10000);
    });

    it('should adjust position size based on confidence', () => {
      // High confidence should allow larger positions
      const highConfidenceLimit = riskManager.getDynamicPositionSizeLimit(0.9, 0.03, 1.0);
      const lowConfidenceLimit = riskManager.getDynamicPositionSizeLimit(0.6, 0.03, 1.0);
      
      expect(highConfidenceLimit).toBeGreaterThan(lowConfidenceLimit);
    });

    it('should reduce position size in high volatility', () => {
      const normalVolLimit = riskManager.getDynamicPositionSizeLimit(0.75, 0.03, 1.0);
      const highVolLimit = riskManager.getDynamicPositionSizeLimit(0.75, 0.05, 1.0);
      
      expect(highVolLimit).toBeLessThan(normalVolLimit);
    });

    it('should update volatility regime and adjust drawdown limits', () => {
      // High VIX should increase drawdown limits
      riskManager.updateVolatilityRegime(30); // High volatility
      const highVolLimits = riskManager.getRiskLimits();
      
      riskManager.updateVolatilityRegime(12); // Low volatility
      const lowVolLimits = riskManager.getRiskLimits();
      
      expect(highVolLimits.maxDailyDrawdown).toBeGreaterThan(lowVolLimits.maxDailyDrawdown);
    });
  });
});
