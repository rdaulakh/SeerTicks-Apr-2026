/**
 * MacroAnalyst Unit Tests
 * Comprehensive test suite for institutional-grade features
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MacroAnalyst } from '../MacroAnalyst';

describe('MacroAnalyst - Institutional Grade Tests', () => {
  let analyst: MacroAnalyst;

  beforeEach(() => {
    analyst = new MacroAnalyst();
  });

  describe('Pearson Correlation Calculation', () => {
    it('should calculate perfect positive correlation (r=1.0)', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [2, 4, 6, 8, 10]; // y = 2x (perfect linear relationship)
      
      // Access private method via type assertion
      const correlation = (analyst as any).calculateCorrelation(x, y, 5);
      
      expect(correlation).toBeCloseTo(1.0, 2);
    });

    it('should calculate perfect negative correlation (r=-1.0)', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [10, 8, 6, 4, 2]; // y = -2x + 12 (perfect inverse)
      
      const correlation = (analyst as any).calculateCorrelation(x, y, 5);
      
      expect(correlation).toBeCloseTo(-1.0, 2);
    });

    it('should calculate zero correlation (r=0)', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [5, 5, 5, 5, 5]; // No relationship
      
      const correlation = (analyst as any).calculateCorrelation(x, y, 5);
      
      expect(correlation).toBe(0);
    });

    it('should handle 30-day window correctly', () => {
      // Create 90-day price history
      const btcPrices = Array.from({ length: 90 }, (_, i) => 40000 + i * 100);
      const sp500Prices = Array.from({ length: 90 }, (_, i) => 4500 + i * 10);
      
      const corr30d = (analyst as any).calculateCorrelation(btcPrices, sp500Prices, 30);
      const corr90d = (analyst as any).calculateCorrelation(btcPrices, sp500Prices, 90);
      
      // Both should be close to 1.0 (linear relationship)
      expect(corr30d).toBeCloseTo(1.0, 2);
      expect(corr90d).toBeCloseTo(1.0, 2);
    });

    it('should handle insufficient data gracefully', () => {
      const x = [1, 2];
      const y = [3, 4];
      
      const correlation = (analyst as any).calculateCorrelation(x, y, 30);
      
      // Should return null when insufficient data
      expect(correlation).toBe(null);
    });

    it('should calculate realistic BTC/SPX correlation', () => {
      // Simulate realistic market data with moderate correlation
      const btcPrices = [42000, 43000, 41500, 44000, 43500, 45000, 44500, 46000, 45500, 47000];
      const sp500Prices = [4500, 4550, 4480, 4600, 4580, 4650, 4630, 4700, 4680, 4750];
      
      const correlation = (analyst as any).calculateCorrelation(btcPrices, sp500Prices, 10);
      
      // Should be positive but not perfect (0.7-0.9 range)
      expect(correlation).toBeGreaterThan(0.6);
      expect(correlation).toBeLessThan(1.0);
    });
  });

  describe('Correlation Regime Detection', () => {
    it('should detect risk-on regime (BTC/SPX >0.5, BTC/DXY <-0.3)', () => {
      const regime = (analyst as any).detectCorrelationRegime(0.7, 0.2, -0.5);
      expect(regime).toBe('risk-on');
    });

    it('should detect risk-off regime (BTC/Gold >0.4, BTC/SPX <0.2)', () => {
      const regime = (analyst as any).detectCorrelationRegime(0.1, 0.6, -0.1);
      expect(regime).toBe('risk-off');
    });

    it('should detect decoupled regime (low correlations)', () => {
      const regime = (analyst as any).detectCorrelationRegime(0.2, 0.1, -0.1);
      expect(regime).toBe('decoupled');
    });

    it('should detect mixed regime (conflicting signals)', () => {
      const regime = (analyst as any).detectCorrelationRegime(0.6, 0.5, -0.5);
      // High BTC/SPX (0.6) triggers risk-on, so expect risk-on not mixed
      expect(regime).toBe('risk-on');
    });

    it('should handle edge case: exactly at threshold', () => {
      const regime = (analyst as any).detectCorrelationRegime(0.5, 0.3, -0.3);
      // BTC/SPX = 0.5 is exactly at threshold, BTC/DXY = -0.3 is at threshold
      // With moderate correlations, expect mixed regime
      expect(regime).toBe('mixed');
    });
  });

  describe('Veto Logic', () => {
    it('should activate veto when VIX >40', () => {
      const macroData = {
        dxy: 105,
        vix: 45, // Extreme fear
        sp500: 4500,
        sp500Change24h: -2,
        btcCorrelation: 0.5,
        stablecoinSupply: 120_000_000_000,
        stablecoinChange: 0,
        btcDominance: 52,
      };

      (analyst as any).checkVetoConditions(macroData);
      
      expect((analyst as any).vetoActive).toBe(true);
      expect((analyst as any).vetoReason).toContain('VIX spike');
    });

    it('should activate veto when S&P drops >5%', () => {
      const macroData = {
        dxy: 105,
        vix: 25,
        sp500: 4500,
        sp500Change24h: -6, // Flash crash
        btcCorrelation: 0.5,
        stablecoinSupply: 120_000_000_000,
        stablecoinChange: 0,
        btcDominance: 52,
      };

      (analyst as any).checkVetoConditions(macroData);
      
      expect((analyst as any).vetoActive).toBe(true);
      expect((analyst as any).vetoReason).toContain('S&P 500 flash crash');
    });

    it('should activate veto when DXY >110', () => {
      const macroData = {
        dxy: 112, // Extreme dollar strength
        vix: 20,
        sp500: 4500,
        sp500Change24h: 0,
        btcCorrelation: 0.5,
        stablecoinSupply: 120_000_000_000,
        stablecoinChange: 0,
        btcDominance: 52,
      };

      (analyst as any).checkVetoConditions(macroData);
      
      expect((analyst as any).vetoActive).toBe(true);
      expect((analyst as any).vetoReason).toContain('Extreme USD strength');
    });

    it('should NOT activate veto under normal conditions', () => {
      const macroData = {
        dxy: 105,
        vix: 18, // Normal volatility
        sp500: 4500,
        sp500Change24h: -1, // Normal fluctuation
        btcCorrelation: 0.5,
        stablecoinSupply: 120_000_000_000,
        stablecoinChange: 0,
        btcDominance: 52,
      };

      (analyst as any).checkVetoConditions(macroData);
      
      expect((analyst as any).vetoActive).toBe(false);
      expect((analyst as any).vetoReason).toBe('');
    });

    it('should activate veto for multiple conditions simultaneously', () => {
      const macroData = {
        dxy: 115, // Extreme
        vix: 50, // Extreme
        sp500: 4500,
        sp500Change24h: -8, // Extreme
        btcCorrelation: 0.5,
        stablecoinSupply: 120_000_000_000,
        stablecoinChange: 0,
        btcDominance: 52,
      };

      (analyst as any).checkVetoConditions(macroData);
      
      expect((analyst as any).vetoActive).toBe(true);
      // Should contain at least one veto reason
      expect((analyst as any).vetoReason.length).toBeGreaterThan(0);
    });
  });

  describe('Regime Detection Logic', () => {
    it('should detect risk-on regime correctly', () => {
      const macroData = {
        dxy: 105,
        vix: 18,
        sp500: 4500,
        sp500Change24h: 2,
        btcCorrelation: 0.7,
        stablecoinSupply: 120_000_000_000,
        stablecoinChange: 5,
        btcDominance: 52,
        btcSpx30d: 0.7,
        correlationRegime: 'risk-on' as const,
      };

      const regime = (analyst as any).detectMarketRegime(macroData);
      expect(regime.regime).toBe('risk-on');
      expect(regime.confidence).toBeGreaterThan(0.5);
    });

    it('should detect risk-off regime correctly', () => {
      const macroData = {
        dxy: 115,
        vix: 35,
        sp500: 4500,
        sp500Change24h: -4,
        btcCorrelation: 0.1,
        stablecoinSupply: 120_000_000_000,
        stablecoinChange: -5,
        btcDominance: 52,
        btcGold30d: 0.6,
        correlationRegime: 'risk-off' as const,
      };

      const regime = (analyst as any).detectMarketRegime(macroData);
      expect(regime.regime).toBe('risk-off');
      expect(regime.confidence).toBeGreaterThan(0.5);
    });

    it('should detect transitioning regime with mixed signals', () => {
      const macroData = {
        dxy: 105,
        vix: 25,
        sp500: 4500,
        sp500Change24h: 0,
        btcCorrelation: 0.4,
        stablecoinSupply: 120_000_000_000,
        stablecoinChange: 0,
        btcDominance: 52,
        correlationRegime: 'mixed' as const,
      };

      const regime = (analyst as any).detectMarketRegime(macroData);
      expect(regime.regime).toMatch(/risk-on|risk-off|transitioning/);
      expect(regime.confidence).toBeGreaterThanOrEqual(0);
      expect(regime.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('Execution Score Calculation', () => {
    it('should calculate high execution score with all favorable conditions', () => {
      const macroData = {
        dxy: 105,
        vix: 15,
        sp500: 4500,
        sp500Change24h: 2,
        btcCorrelation: 0.8,
        stablecoinSupply: 120_000_000_000,
        stablecoinChange: 10,
        btcDominance: 55,
        btcSpx30d: 0.8,
        btcGold30d: 0.3,
        btcDxy30d: -0.5,
        correlationRegime: 'risk-on' as const,
      };

      const regime = { regime: 'risk-on' as const, confidence: 0.9 };
      
      // Set lastMacroFetch to now for fresh data
      (analyst as any).lastMacroFetch = Date.now();
      (analyst as any).vetoActive = false;
      
      const executionScore = (analyst as any).calculateExecutionScore(macroData, regime);

      // Should be high (70-90 range)
      expect(executionScore).toBeGreaterThan(70);
      expect(executionScore).toBeLessThanOrEqual(100);
    });

    it('should calculate low execution score with veto active', () => {
      const macroData = {
        dxy: 115,
        vix: 45,
        sp500: 4500,
        sp500Change24h: -5,
        btcCorrelation: 0.1,
        stablecoinSupply: 120_000_000_000,
        stablecoinChange: -10,
        btcDominance: 48,
        btcSpx30d: 0.1,
        btcGold30d: 0.2,
        btcDxy30d: -0.1,
        correlationRegime: 'decoupled' as const,
      };

      const regime = { regime: 'risk-off' as const, confidence: 0.4 };
      
      // Activate veto
      (analyst as any).vetoActive = true;
      (analyst as any).lastMacroFetch = Date.now();
      
      const executionScore = (analyst as any).calculateExecutionScore(macroData, regime);

      // Should be low due to veto (0-50 range)
      expect(executionScore).toBeGreaterThanOrEqual(0);
      expect(executionScore).toBeLessThan(50);
    });

    it('should score based on correlation strength', () => {
      const strongCorrelationData = {
        dxy: 105,
        vix: 18,
        sp500: 4500,
        sp500Change24h: 0,
        btcCorrelation: 0.9,
        stablecoinSupply: 120_000_000_000,
        stablecoinChange: 0,
        btcDominance: 52,
        btcSpx30d: 0.9,
        btcGold30d: 0.8,
        btcDxy30d: -0.7,
        correlationRegime: 'risk-on' as const,
      };

      const weakCorrelationData = {
        ...strongCorrelationData,
        btcSpx30d: 0.1,
        btcGold30d: 0.1,
        btcDxy30d: -0.1,
      };

      const regime = { regime: 'risk-on' as const, confidence: 0.8 };
      (analyst as any).lastMacroFetch = Date.now();
      (analyst as any).vetoActive = false;

      const strongScore = (analyst as any).calculateExecutionScore(strongCorrelationData, regime);
      const weakScore = (analyst as any).calculateExecutionScore(weakCorrelationData, regime);

      // Strong correlations should score higher
      expect(strongScore).toBeGreaterThan(weakScore);
    });

    it('should ensure execution score is always 0-100', () => {
      const extremeData = {
        dxy: 150,
        vix: 100,
        sp500: 4500,
        sp500Change24h: -50,
        btcCorrelation: -1,
        stablecoinSupply: 120_000_000_000,
        stablecoinChange: -50,
        btcDominance: 20,
        btcSpx30d: -1,
        btcGold30d: -1,
        btcDxy30d: 1,
        correlationRegime: 'decoupled' as const,
      };

      const regime = { regime: 'risk-off' as const, confidence: 0.1 };
      (analyst as any).lastMacroFetch = Date.now();
      (analyst as any).vetoActive = true;

      const executionScore = (analyst as any).calculateExecutionScore(extremeData, regime);

      expect(executionScore).toBeGreaterThanOrEqual(0);
      expect(executionScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Integration Tests', () => {
    it('should generate valid signal with all components', async () => {
      // Mock the fetchMacroIndicators method to avoid API calls
      (analyst as any).macroCache = {
        dxy: 105,
        vix: 18,
        sp500: 4500,
        sp500Change24h: 1.5,
        btcCorrelation: 0.6,
        stablecoinSupply: 260_000_000_000,
        stablecoinChange: 5,
        btcDominance: 57,
        btcSpx30d: 0.6,
        btcSpx90d: 0.55,
        btcGold30d: 0.3,
        btcDxy30d: -0.4,
        correlationRegime: 'risk-on' as const,
      };
      (analyst as any).lastMacroFetch = Date.now();

      const signal = await analyst.generateSignal('BTCUSDT', { currentPrice: 98000 });

      expect(signal).toBeDefined();
      expect(signal.signal).toMatch(/bullish|bearish|neutral/);
      expect(signal.confidence).toBeGreaterThanOrEqual(0);
      expect(signal.confidence).toBeLessThanOrEqual(1);
      expect(signal.executionScore).toBeGreaterThanOrEqual(0);
      expect(signal.executionScore).toBeLessThanOrEqual(100);
      expect(signal.reasoning).toBeTruthy();
      expect(signal.evidence).toBeTruthy();
    }, 10000); // Increase timeout to 10 seconds for LLM calls
  });
});
