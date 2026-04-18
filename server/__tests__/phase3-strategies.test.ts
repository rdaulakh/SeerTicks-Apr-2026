/**
 * Phase 3: Strategy Expansion Tests
 * Comprehensive tests for Order Flow, Smart Money, Statistical Arbitrage, and Grid Trading
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Order Flow imports
import { TapeReader, resetTapeReader } from '../strategies/orderflow/TapeReader';
import { VolumeDeltaAnalyzer, resetVolumeDeltaAnalyzer } from '../strategies/orderflow/VolumeDeltaAnalyzer';
import { OrderImbalanceDetector, resetOrderImbalanceDetector } from '../strategies/orderflow/OrderImbalanceDetector';
import { AbsorptionDetector, resetAbsorptionDetector } from '../strategies/orderflow/AbsorptionDetector';
import { FootprintChartAnalyzer, resetFootprintChartAnalyzer } from '../strategies/orderflow/FootprintChartAnalyzer';
import { OrderFlowManager, resetOrderFlowManager } from '../strategies/orderflow';

// Smart Money imports
import { LiquidityGrabDetector, resetLiquidityGrabDetector } from '../strategies/smartmoney/LiquidityGrabDetector';
import { OrderBlockIdentifier, resetOrderBlockIdentifier } from '../strategies/smartmoney/OrderBlockIdentifier';
import { FairValueGapDetector, resetFairValueGapDetector } from '../strategies/smartmoney/FairValueGapDetector';
import { BreakOfStructure, resetBreakOfStructure } from '../strategies/smartmoney/BreakOfStructure';
import { SmartMoneyManager, resetSmartMoneyManager } from '../strategies/smartmoney';

// Statistical imports
import { PairTradingEngine, resetPairTradingEngine } from '../strategies/statistical/PairTradingEngine';
import { MeanReversionAnalyzer, resetMeanReversionAnalyzer } from '../strategies/statistical/MeanReversionAnalyzer';
import { GridTradingEngine, resetGridTradingEngine } from '../strategies/statistical/GridTradingEngine';
import { StatisticalArbitrageManager, resetStatisticalArbitrageManager } from '../strategies/statistical';

// Scoring imports
import { StrategyCompetenceTracker, resetStrategyCompetenceTracker } from '../strategies/scoring/StrategyCompetenceTracker';

// Unified imports
import { UnifiedStrategyManager, resetUnifiedStrategyManager } from '../strategies';

// Helper to generate test candles
function generateCandles(count: number, startPrice: number, volatility: number = 0.02): any[] {
  const candles = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 2 * volatility * price;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);
    candles.push({ symbol: 'BTCUSDT', timestamp: Date.now() - (count - i) * 60000, open, high, low, close, volume: Math.random() * 100 });
    price = close;
  }
  return candles;
}

// Helper to generate test trades
function generateTrades(count: number, basePrice: number): any[] {
  const trades = [];
  for (let i = 0; i < count; i++) {
    trades.push({
      symbol: 'BTCUSDT',
      timestamp: Date.now() - (count - i) * 1000,
      price: basePrice * (1 + (Math.random() - 0.5) * 0.01),
      quantity: Math.random() * 10,
      side: Math.random() > 0.5 ? 'buy' : 'sell' as 'buy' | 'sell',
    });
  }
  return trades;
}

describe('Phase 3: Order Flow Strategies', () => {
  beforeEach(() => {
    resetTapeReader();
    resetVolumeDeltaAnalyzer();
    resetOrderImbalanceDetector();
    resetAbsorptionDetector();
    resetFootprintChartAnalyzer();
    resetOrderFlowManager();
  });

  describe('TapeReader', () => {
    it('should process trades and calculate metrics', () => {
      const reader = new TapeReader();
      const trades = generateTrades(20, 50000);
      
      let metrics: any;
      for (const trade of trades) {
        metrics = reader.processTrade(trade);
      }
      
      expect(metrics).toBeDefined();
      expect(metrics.symbol).toBe('BTCUSDT');
      expect(metrics.totalVolume).toBeGreaterThan(0);
      expect(metrics.direction).toMatch(/bullish|bearish|neutral/);
    });

    it('should detect large trades', () => {
      const reader = new TapeReader({ largeTradeThreshold: 5 });
      let largeTrades = 0;
      reader.on('largeTrade', () => largeTrades++);
      
      reader.processTrade({ symbol: 'BTCUSDT', timestamp: Date.now(), price: 50000, quantity: 10, side: 'buy' });
      reader.processTrade({ symbol: 'BTCUSDT', timestamp: Date.now(), price: 50000, quantity: 2, side: 'sell' });
      
      expect(largeTrades).toBe(1);
    });
  });

  describe('VolumeDeltaAnalyzer', () => {
    it('should calculate cumulative volume delta', () => {
      const analyzer = new VolumeDeltaAnalyzer();
      
      analyzer.processTrade({ symbol: 'BTCUSDT', timestamp: Date.now(), price: 50000, quantity: 10, side: 'buy' });
      analyzer.processTrade({ symbol: 'BTCUSDT', timestamp: Date.now(), price: 50000, quantity: 5, side: 'sell' });
      
      const metrics = analyzer.getMetrics('BTCUSDT');
      expect(metrics).toBeDefined();
      expect(metrics!.cumulativeDelta).toBe(5); // 10 - 5
    });
  });

  describe('OrderImbalanceDetector', () => {
    it('should detect order imbalances', () => {
      const detector = new OrderImbalanceDetector({ imbalanceThreshold: 2.0 });
      
      // Create buy imbalance
      for (let i = 0; i < 10; i++) {
        detector.processTrade({ symbol: 'BTCUSDT', timestamp: Date.now(), price: 50000, quantity: 10, side: 'buy' });
      }
      for (let i = 0; i < 2; i++) {
        detector.processTrade({ symbol: 'BTCUSDT', timestamp: Date.now(), price: 50000, quantity: 5, side: 'sell' });
      }
      
      const metrics = detector.getMetrics('BTCUSDT');
      expect(metrics).toBeDefined();
      expect(metrics!.direction).toBe('buy');
      expect(metrics!.isSignificant).toBe(true);
    });
  });

  describe('OrderFlowManager', () => {
    it('should aggregate all order flow signals', () => {
      const manager = new OrderFlowManager();
      const trades = generateTrades(50, 50000);
      
      for (const trade of trades) {
        manager.processTrade(trade);
      }
      
      const signal = manager.getAggregatedSignal('BTCUSDT');
      expect(signal).toBeDefined();
      expect(signal.direction).toMatch(/bullish|bearish|neutral/);
      expect(signal.strength).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('Phase 3: Smart Money Concepts', () => {
  beforeEach(() => {
    resetLiquidityGrabDetector();
    resetOrderBlockIdentifier();
    resetFairValueGapDetector();
    resetBreakOfStructure();
    resetSmartMoneyManager();
  });

  describe('LiquidityGrabDetector', () => {
    it('should identify liquidity pools', () => {
      const detector = new LiquidityGrabDetector();
      const candles = generateCandles(30, 50000);
      
      for (const candle of candles) {
        detector.processCandle(candle);
      }
      
      const metrics = detector.getMetrics('BTCUSDT');
      expect(metrics).toBeDefined();
      expect(Array.isArray(metrics!.pools)).toBe(true);
    });
  });

  describe('OrderBlockIdentifier', () => {
    it('should identify order blocks', () => {
      const identifier = new OrderBlockIdentifier();
      
      // Create scenario for order block
      const candles = [
        { symbol: 'BTCUSDT', timestamp: Date.now() - 4000, open: 50000, high: 50100, low: 49900, close: 49950, volume: 100 },
        { symbol: 'BTCUSDT', timestamp: Date.now() - 3000, open: 49950, high: 50000, low: 49800, close: 49850, volume: 100 },
        { symbol: 'BTCUSDT', timestamp: Date.now() - 2000, open: 49850, high: 49900, low: 49700, close: 49750, volume: 100 },
        { symbol: 'BTCUSDT', timestamp: Date.now() - 1000, open: 49750, high: 50500, low: 49700, close: 50400, volume: 200 },
      ];
      
      for (const candle of candles) {
        identifier.processCandle(candle);
      }
      
      const metrics = identifier.getMetrics('BTCUSDT');
      expect(metrics).toBeDefined();
    });
  });

  describe('FairValueGapDetector', () => {
    it('should detect fair value gaps', () => {
      const detector = new FairValueGapDetector({ minGapPercent: 0.1 });
      
      // Create FVG scenario
      const candles = [
        { symbol: 'BTCUSDT', timestamp: Date.now() - 3000, open: 50000, high: 50100, low: 49900, close: 50050, volume: 100 },
        { symbol: 'BTCUSDT', timestamp: Date.now() - 2000, open: 50050, high: 50200, low: 50000, close: 50150, volume: 100 },
        { symbol: 'BTCUSDT', timestamp: Date.now() - 1000, open: 50200, high: 50500, low: 50150, close: 50400, volume: 100 },
      ];
      
      for (const candle of candles) {
        detector.processCandle(candle);
      }
      
      const metrics = detector.getMetrics('BTCUSDT');
      expect(metrics).toBeDefined();
    });
  });

  describe('BreakOfStructure', () => {
    it('should detect market structure changes', () => {
      const bos = new BreakOfStructure();
      const candles = generateCandles(50, 50000, 0.03);
      
      for (const candle of candles) {
        bos.processCandle(candle);
      }
      
      const structure = bos.getStructure('BTCUSDT');
      expect(structure).toBeDefined();
      expect(structure!.trend).toMatch(/bullish|bearish|ranging/);
    });
  });

  describe('SmartMoneyManager', () => {
    it('should aggregate all SMC signals', () => {
      const manager = new SmartMoneyManager();
      const candles = generateCandles(50, 50000);
      
      for (const candle of candles) {
        manager.processCandle(candle);
      }
      
      const signal = manager.getAggregatedSignal('BTCUSDT');
      expect(signal).toBeDefined();
      expect(signal.direction).toMatch(/bullish|bearish|neutral/);
      expect(signal.tradingLevels).toBeDefined();
    });
  });
});

describe('Phase 3: Statistical Arbitrage', () => {
  beforeEach(() => {
    resetPairTradingEngine();
    resetMeanReversionAnalyzer();
    resetGridTradingEngine();
    resetStatisticalArbitrageManager();
  });

  describe('PairTradingEngine', () => {
    it('should track correlated pairs', () => {
      const engine = new PairTradingEngine();
      engine.start();
      
      const pairId = engine.registerPair('BTCUSDT', 'ETHUSDT');
      
      // Process correlated prices
      for (let i = 0; i < 30; i++) {
        const btcPrice = 50000 + Math.sin(i * 0.1) * 1000;
        const ethPrice = 3000 + Math.sin(i * 0.1) * 60;
        engine.processPrice({ symbol: 'BTCUSDT', timestamp: Date.now(), price: btcPrice });
        engine.processPrice({ symbol: 'ETHUSDT', timestamp: Date.now(), price: ethPrice });
      }
      
      const pair = engine.getPair(pairId);
      expect(pair).toBeDefined();
      expect(pair!.correlation).toBeDefined();
      
      engine.stop();
    });
  });

  describe('MeanReversionAnalyzer', () => {
    it('should calculate mean reversion metrics', () => {
      const analyzer = new MeanReversionAnalyzer();
      const candles = generateCandles(50, 50000);
      
      for (const candle of candles) {
        analyzer.processPrice(candle);
      }
      
      const metrics = analyzer.getMetrics('BTCUSDT');
      expect(metrics).toBeDefined();
      expect(metrics!.zScore).toBeDefined();
      expect(metrics!.rsi).toBeGreaterThanOrEqual(0);
      expect(metrics!.rsi).toBeLessThanOrEqual(100);
      expect(metrics!.regime).toMatch(/trending|mean_reverting|volatile/);
    });
  });

  describe('GridTradingEngine', () => {
    it('should create and manage grids', () => {
      const engine = new GridTradingEngine();
      engine.start();
      
      const grid = engine.createGrid({
        symbol: 'BTCUSDT',
        upperPrice: 52000,
        lowerPrice: 48000,
        gridCount: 10,
        totalInvestment: 10000,
      });
      
      expect(grid).toBeDefined();
      expect(grid.levels.length).toBe(11);
      expect(grid.status).toBe('active');
      
      // Process price to trigger grid levels
      engine.processPrice({ symbol: 'BTCUSDT', timestamp: Date.now(), price: 48500 });
      
      const metrics = engine.getGridMetrics(grid.id);
      expect(metrics).toBeDefined();
      
      engine.stop();
    });

    it('should calculate optimal grid parameters', () => {
      const engine = new GridTradingEngine();
      const params = engine.calculateOptimalGrid('BTCUSDT', 50000, 20, 10000);
      
      expect(params.upperPrice).toBeGreaterThan(50000);
      expect(params.lowerPrice).toBeLessThan(50000);
      expect(params.gridCount).toBeGreaterThanOrEqual(5);
    });
  });
});

describe('Phase 3: Strategy Competence Scoring', () => {
  beforeEach(() => {
    resetStrategyCompetenceTracker();
  });

  describe('StrategyCompetenceTracker', () => {
    it('should track strategy performance', () => {
      const tracker = new StrategyCompetenceTracker({ baselineScore: 50, targetImprovement: 13 });
      
      // Record winning trades
      for (let i = 0; i < 10; i++) {
        tracker.recordTrade('TapeReader', 'orderflow', { profit: 100, prediction: 'bullish', actual: 'bullish' });
      }
      
      // Record some losing trades
      for (let i = 0; i < 3; i++) {
        tracker.recordTrade('TapeReader', 'orderflow', { profit: -50, prediction: 'bullish', actual: 'bearish' });
      }
      
      const score = tracker.getStrategyScore('TapeReader');
      expect(score).toBeDefined();
      expect(score!.winRate).toBeGreaterThan(50);
      expect(score!.totalTrades).toBe(13);
    });

    it('should generate competence report', () => {
      const tracker = new StrategyCompetenceTracker({ baselineScore: 50, targetImprovement: 13 });
      
      // Add trades for multiple strategies
      for (let i = 0; i < 10; i++) {
        tracker.recordTrade('OrderFlow', 'orderflow', { profit: 100, prediction: 'bullish', actual: 'bullish' });
        tracker.recordTrade('SmartMoney', 'smartmoney', { profit: 80, prediction: 'bearish', actual: 'bearish' });
        tracker.recordTrade('GridTrading', 'grid', { profit: 50, prediction: 'neutral', actual: 'neutral' });
      }
      
      const report = tracker.generateReport();
      expect(report).toBeDefined();
      expect(report.categoryScores.length).toBe(4);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('should track improvement towards target', () => {
      const tracker = new StrategyCompetenceTracker({ baselineScore: 50, targetImprovement: 13 });
      
      // Simulate good performance
      for (let i = 0; i < 20; i++) {
        tracker.recordTrade('Strategy1', 'orderflow', { profit: 100, prediction: 'bullish', actual: 'bullish' });
        tracker.recordTrade('Strategy2', 'smartmoney', { profit: 100, prediction: 'bullish', actual: 'bullish' });
      }
      
      const improvement = tracker.getImprovement();
      expect(improvement).toBeDefined();
    });
  });
});

describe('Phase 3: Unified Strategy Manager', () => {
  beforeEach(() => {
    resetUnifiedStrategyManager();
    resetOrderFlowManager();
    resetSmartMoneyManager();
    resetStatisticalArbitrageManager();
    resetStrategyCompetenceTracker();
  });

  describe('UnifiedStrategyManager', () => {
    it('should integrate all strategy modules', () => {
      const manager = new UnifiedStrategyManager();
      manager.start();
      
      const candles = generateCandles(50, 50000);
      for (const candle of candles) {
        manager.processCandle(candle);
      }
      
      const signal = manager.getUnifiedSignal('BTCUSDT');
      expect(signal).toBeDefined();
      expect(signal.direction).toMatch(/bullish|bearish|neutral/);
      expect(signal.sources).toBeDefined();
      expect(signal.tradingLevels).toBeDefined();
      
      manager.stop();
    });

    it('should track competence across strategies', () => {
      const manager = new UnifiedStrategyManager();
      manager.start();
      
      // Record trades
      manager.recordTradeResult('OrderFlow', 'orderflow', { profit: 100, prediction: 'bullish', actual: 'bullish' });
      manager.recordTradeResult('SmartMoney', 'smartmoney', { profit: 80, prediction: 'bearish', actual: 'bearish' });
      
      const report = manager.getCompetenceReport();
      expect(report).toBeDefined();
      
      manager.stop();
    });

    it('should provide access to individual managers', () => {
      const manager = new UnifiedStrategyManager();
      
      expect(manager.getOrderFlowManager()).toBeDefined();
      expect(manager.getSmartMoneyManager()).toBeDefined();
      expect(manager.getStatisticalManager()).toBeDefined();
      expect(manager.getCompetenceTracker()).toBeDefined();
    });
  });
});

describe('Phase 3: Integration Tests', () => {
  beforeEach(() => {
    resetUnifiedStrategyManager();
  });

  it('should process real-time data flow', () => {
    const manager = new UnifiedStrategyManager();
    manager.start();
    
    // Simulate real-time data
    const trades = generateTrades(100, 50000);
    const candles = generateCandles(30, 50000);
    
    for (const trade of trades) {
      manager.processTrade(trade);
    }
    
    for (const candle of candles) {
      manager.processCandle(candle);
    }
    
    const signal = manager.getUnifiedSignal('BTCUSDT');
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.competenceScore).toBeGreaterThanOrEqual(0);
    
    manager.stop();
  });

  it('should handle multiple symbols', () => {
    const manager = new UnifiedStrategyManager();
    manager.start();
    
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    
    for (const symbol of symbols) {
      const candles = generateCandles(20, symbol === 'BTCUSDT' ? 50000 : symbol === 'ETHUSDT' ? 3000 : 100);
      for (const candle of candles) {
        candle.symbol = symbol;
        manager.processCandle(candle);
      }
    }
    
    for (const symbol of symbols) {
      const signal = manager.getUnifiedSignal(symbol);
      expect(signal.symbol).toBe(symbol);
    }
    
    manager.stop();
  });
});
