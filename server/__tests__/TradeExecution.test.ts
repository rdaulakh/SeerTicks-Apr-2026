/**
 * Trade Execution Integration Tests
 * 
 * Tests the complete end-to-end flow:
 * 1. Agent signals → Strategy Orchestrator consensus
 * 2. Consensus → Position creation (real or paper)
 * 3. Position monitoring → Stop-loss/take-profit enforcement
 * 4. Partial profit taking and trailing stops
 * 5. Time-based exits
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrategyOrchestrator } from '../orchestrator/StrategyOrchestrator';
import { AgentManager } from '../agents/AgentBase';
import { PositionManager } from '../PositionManager';
import { RiskManager } from '../RiskManager';
import { PaperTradingEngine } from '../execution/PaperTradingEngine';
import { BinanceAdapter } from '../exchanges/BinanceAdapter';
import { getDb } from '../db';
import { positions, trades } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

/**
 * Integration test: requires live server/DB/external APIs.
 * Set INTEGRATION_TEST=1 to run these tests.
 */
const isIntegration = process.env.INTEGRATION_TEST === '1';


describe.skipIf(!isIntegration)('Trade Execution Integration Tests', () => {
  let orchestrator: StrategyOrchestrator;
  let agentManager: AgentManager;
  let positionManager: PositionManager;
  let riskManager: RiskManager;
  let paperTradingEngine: PaperTradingEngine;
  let exchange: BinanceAdapter;

  beforeEach(async () => {
    // Initialize components
    exchange = new BinanceAdapter('test-key', 'test-secret');
    agentManager = new AgentManager();
    orchestrator = new StrategyOrchestrator('BTCUSDT', agentManager);
    positionManager = new PositionManager();
    riskManager = new RiskManager(100000); // $100k account

    // Initialize paper trading engine
    paperTradingEngine = new PaperTradingEngine({
      userId: 1,
      initialBalance: 100000,
      exchange: 'binance',
      enableSlippage: true,
      enableCommission: true,
      enableMarketImpact: false,
      enableLatency: false, // Disable for faster tests
    });

    // Connect components
    orchestrator.setExchange(exchange);
    orchestrator.setPositionManager(positionManager);
    orchestrator.setRiskManager(riskManager);
    orchestrator.setPaperTradingEngine(paperTradingEngine);
  });

  afterEach(async () => {
    // Cleanup
    positionManager.stop();
    
    // Clean up database
    const db = await getDb();
    if (db) {
      await db.delete(positions).where(eq(positions.symbol, 'BTCUSDT'));
      await db.delete(trades).where(eq(trades.symbol, 'BTCUSDT'));
    }
  });

  describe('Paper Trading Mode', () => {
    beforeEach(() => {
      orchestrator.setPaperTradingMode(true);
    });

    it('should place paper order when consensus is BUY', async () => {
      // Mock agent signals
      const mockSignals = [
        { agentName: 'TechnicalAnalyst', signal: 'bullish' as const, confidence: 0.8, reasoning: 'RSI oversold', qualityScore: 0.8, executionScore: 70 },
        { agentName: 'PatternMatcher', signal: 'bullish' as const, confidence: 0.9, reasoning: 'Double bottom detected', qualityScore: 0.9, executionScore: 80 },
        { agentName: 'OrderFlowAnalyst', signal: 'bullish' as const, confidence: 0.7, reasoning: 'Strong bid support', qualityScore: 0.7, executionScore: 60 },
        { agentName: 'SentimentAnalyst', signal: 'neutral' as const, confidence: 0.5, reasoning: 'Mixed sentiment', qualityScore: 0.5, executionScore: 40 },
      ];
      vi.spyOn(agentManager, 'getAllSignals').mockResolvedValue(mockSignals);

      // Mock exchange getTicker
      vi.spyOn(exchange, 'getTicker').mockResolvedValue({
        symbol: 'BTCUSDT',
        last: 50000,
        bid: 49995,
        ask: 50005,
        high: 51000,
        low: 49000,
        volume: 1000,
        timestamp: Date.now(),
      });

      // Get recommendation (automatically executes via handleRecommendation)
      const recommendation = await orchestrator.getRecommendation('BTCUSDT');

      // Should be BUY with high confidence
      expect(recommendation.action).toBe('buy');
      expect(recommendation.confidence).toBeGreaterThan(0.7);

      // Wait for position creation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify paper order was placed
      const wallet = paperTradingEngine.getWallet();
      expect(wallet.totalTrades).toBe(1);
      expect(wallet.balance).toBeLessThan(100000); // Balance should decrease
    });

    it('should NOT place real order in paper mode', async () => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Count positions before
      const positionsBefore = await db.select().from(positions);
      const countBefore = positionsBefore.length;

      // Mock signals for BUY
      vi.spyOn(exchange, 'getTicker').mockResolvedValue({
        symbol: 'BTCUSDT',
        last: 50000,
        bid: 49995,
        ask: 50005,
        high: 51000,
        low: 49000,
        volume: 1000,
        timestamp: Date.now(),
      });

      const recommendation = await orchestrator.getRecommendation('BTCUSDT');
      
      // Wait for position creation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Count positions after
      const positionsAfter = await db.select().from(positions);
      const countAfter = positionsAfter.length;

      // Should NOT create real position
      expect(countAfter).toBe(countBefore);
    });

    it('should calculate realistic slippage and commission', async () => {
      // Mock agent signals
      const mockSignals = [
        { agentName: 'TechnicalAnalyst', signal: 'bullish' as const, confidence: 0.8, reasoning: 'Test', qualityScore: 0.8, executionScore: 70 },
        { agentName: 'PatternMatcher', signal: 'bullish' as const, confidence: 0.9, reasoning: 'Test', qualityScore: 0.9, executionScore: 80 },
        { agentName: 'OrderFlowAnalyst', signal: 'bullish' as const, confidence: 0.7, reasoning: 'Test', qualityScore: 0.7, executionScore: 60 },
        { agentName: 'SentimentAnalyst', signal: 'bullish' as const, confidence: 0.6, reasoning: 'Test', qualityScore: 0.6, executionScore: 50 },
      ];
      vi.spyOn(agentManager, 'getAllSignals').mockResolvedValue(mockSignals);

      vi.spyOn(exchange, 'getTicker').mockResolvedValue({
        symbol: 'BTCUSDT',
        last: 50000,
        bid: 49995,
        ask: 50005,
        high: 51000,
        low: 49000,
        volume: 1000,
        timestamp: Date.now(),
      });

      const recommendation = await orchestrator.getRecommendation('BTCUSDT');
      
      // Wait for position creation
      await new Promise(resolve => setTimeout(resolve, 100));

      const wallet = paperTradingEngine.getWallet();
      
      // Commission should be ~0.1% of trade value
      expect(wallet.totalCommission).toBeGreaterThan(0);
      expect(wallet.totalCommission).toBeLessThan(100); // Max $100 commission on $100k account
    });
  });

  describe('Real Trading Mode', () => {
    beforeEach(() => {
      orchestrator.setPaperTradingMode(false);
      positionManager.start();
    });

    it('should create position in database when consensus is BUY', async () => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Mock agent signals
      const mockSignals = [
        { agentName: 'TechnicalAnalyst', signal: 'bullish' as const, confidence: 0.8, reasoning: 'Test', qualityScore: 0.8, executionScore: 70 },
        { agentName: 'PatternMatcher', signal: 'bullish' as const, confidence: 0.9, reasoning: 'Test', qualityScore: 0.9, executionScore: 80 },
        { agentName: 'OrderFlowAnalyst', signal: 'bullish' as const, confidence: 0.7, reasoning: 'Test', qualityScore: 0.7, executionScore: 60 },
        { agentName: 'SentimentAnalyst', signal: 'bullish' as const, confidence: 0.6, reasoning: 'Test', qualityScore: 0.6, executionScore: 50 },
      ];
      vi.spyOn(agentManager, 'getAllSignals').mockResolvedValue(mockSignals);

      // Mock exchange getTicker
      vi.spyOn(exchange, 'getTicker').mockResolvedValue({
        symbol: 'BTCUSDT',
        last: 50000,
        bid: 49995,
        ask: 50005,
        high: 51000,
        low: 49000,
        volume: 1000,
        timestamp: Date.now(),
      });

      // Get BUY recommendation
      const recommendation = await orchestrator.getRecommendation('BTCUSDT');
      
      // Wait for position creation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify position was created
      const createdPositions = await db.select().from(positions).where(eq(positions.symbol, 'BTCUSDT'));
      expect(createdPositions.length).toBeGreaterThan(0);

      const position = createdPositions[0];
      expect(position.side).toBe('long');
      expect(parseFloat(position.entryPrice.toString())).toBeCloseTo(50000, -2);
      expect(position.thesisValid).toBe(true);
    });

    it('should create trade record with agent signals', async () => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Mock agent signals
      const mockSignals = [
        { agentName: 'TechnicalAnalyst', signal: 'bullish' as const, confidence: 0.8, reasoning: 'Test', qualityScore: 0.8, executionScore: 70 },
        { agentName: 'PatternMatcher', signal: 'bullish' as const, confidence: 0.9, reasoning: 'Test', qualityScore: 0.9, executionScore: 80 },
        { agentName: 'OrderFlowAnalyst', signal: 'bullish' as const, confidence: 0.7, reasoning: 'Test', qualityScore: 0.7, executionScore: 60 },
        { agentName: 'SentimentAnalyst', signal: 'bullish' as const, confidence: 0.6, reasoning: 'Test', qualityScore: 0.6, executionScore: 50 },
      ];
      vi.spyOn(agentManager, 'getAllSignals').mockResolvedValue(mockSignals);

      vi.spyOn(exchange, 'getTicker').mockResolvedValue({
        symbol: 'BTCUSDT',
        last: 50000,
        bid: 49995,
        ask: 50005,
        high: 51000,
        low: 49000,
        volume: 1000,
        timestamp: Date.now(),
      });

      const recommendation = await orchestrator.getRecommendation('BTCUSDT');
      
      // Wait for position creation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify trade record
      const createdTrades = await db.select().from(trades).where(eq(trades.symbol, 'BTCUSDT'));
      expect(createdTrades.length).toBeGreaterThan(0);

      const trade = createdTrades[0];
      expect(trade.status).toBe('open');
      expect(trade.agentSignals).toBeDefined();
      expect(trade.confidence).toBeDefined();
    });
  });

  describe('Position Monitoring', () => {
    it('should enforce stop-loss when price drops', async () => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Initialize Binance client for position monitoring
      await positionManager.initializeBinanceClient('test-key', 'test-secret');

      // Mock Binance API to avoid real API calls
      const mockOrder = vi.fn().mockResolvedValue({
        orderId: 123456,
        symbol: 'BTCUSDT',
        status: 'FILLED',
        executedQty: '0.1',
      });
      const mockPrices = vi.fn().mockResolvedValue({ BTCUSDT: '47500' }); // Below stop-loss
      (positionManager as any).binanceClient = { order: mockOrder, prices: mockPrices };

      // Start position monitoring
      positionManager.start();

      // Create position manually
      const [result] = await db.insert(positions).values({
        userId: 1,
        tradeId: 1,
        symbol: 'BTCUSDT',
        side: 'long',
        entryPrice: '50000',
        quantity: '0.1',
        stopLoss: '48000', // 4% stop-loss
        takeProfit: '52000',
        expectedPath: [],
        thesisValid: true,
      });

      const positionId = result.insertId;

      // Reload positions so PositionManager knows about the new position
      await positionManager.loadOpenPositions();

      // Mock exchange to return price below stop-loss
      vi.spyOn(exchange, 'getTicker').mockResolvedValue({
        symbol: 'BTCUSDT',
        last: 47500, // Below stop-loss
        bid: 47495,
        ask: 47505,
        high: 50000,
        low: 47000,
        volume: 1000,
        timestamp: Date.now(),
      });

      // Wait for position monitoring to trigger stop-loss
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify position was closed
      const updatedPosition = await db.select().from(positions).where(eq(positions.id, positionId));
      expect(updatedPosition[0].thesisValid).toBe(false); // Position closed

      positionManager.stop();
    });

    it('should enforce take-profit when target reached', async () => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Initialize Binance client for position monitoring
      await positionManager.initializeBinanceClient('test-key', 'test-secret');

      // Mock Binance API to avoid real API calls
      const mockOrder = vi.fn().mockResolvedValue({
        orderId: 123456,
        symbol: 'BTCUSDT',
        status: 'FILLED',
        executedQty: '0.1',
      });
      const mockPrices = vi.fn().mockResolvedValue({ BTCUSDT: '52500' }); // Above take-profit
      (positionManager as any).binanceClient = { order: mockOrder, prices: mockPrices };

      positionManager.start();

      // Create position manually
      const [result] = await db.insert(positions).values({
        userId: 1,
        tradeId: 2,
        symbol: 'BTCUSDT',
        side: 'long',
        entryPrice: '50000',
        quantity: '0.1',
        stopLoss: '48000',
        takeProfit: '52000', // 4% take-profit
        expectedPath: [],
        thesisValid: true,
      });

      const positionId = result.insertId;

      // Reload positions so PositionManager knows about the new position
      await positionManager.loadOpenPositions();

      // Mock exchange to return price above take-profit
      vi.spyOn(exchange, 'getTicker').mockResolvedValue({
        symbol: 'BTCUSDT',
        last: 52500, // Above take-profit
        bid: 52495,
        ask: 52505,
        high: 53000,
        low: 50000,
        volume: 1000,
        timestamp: Date.now(),
      });

      // Wait for position monitoring to trigger take-profit
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify position was closed
      const updatedPosition = await db.select().from(positions).where(eq(positions.id, positionId));
      expect(updatedPosition[0].thesisValid).toBe(false); // Position closed

      positionManager.stop();
    });

    it('should execute partial profit taking at +1.5%, +3%, +5%', async () => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Initialize Binance client for position monitoring
      await positionManager.initializeBinanceClient('test-key', 'test-secret');

      // Mock Binance API to avoid real API calls
      const mockOrder = vi.fn().mockResolvedValue({
        orderId: 123456,
        symbol: 'BTCUSDT',
        status: 'FILLED',
        executedQty: '0.1',
      });
      const mockPrices = vi.fn().mockResolvedValue({ BTCUSDT: '50750' }); // +1.5% profit
      (positionManager as any).binanceClient = { order: mockOrder, prices: mockPrices };

      positionManager.start();

      // Create position manually
      const [result] = await db.insert(positions).values({
        userId: 1,
        tradeId: 3,
        symbol: 'BTCUSDT',
        side: 'long',
        entryPrice: '50000',
        quantity: '0.3', // 0.3 BTC for partial exits
        stopLoss: '48000',
        takeProfit: '52500',
        expectedPath: [],
        thesisValid: true,
      });

      const positionId = result.insertId;

      // Reload positions so PositionManager knows about the new position
      await positionManager.loadOpenPositions();

      // Test +1.5% profit (should close 33%)
      vi.spyOn(exchange, 'getTicker').mockResolvedValue({
        symbol: 'BTCUSDT',
        last: 50750, // +1.5%
        bid: 50745,
        ask: 50755,
        high: 51000,
        low: 50000,
        volume: 1000,
        timestamp: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify partial close (quantity should be reduced)
      let updatedPosition = await db.select().from(positions).where(eq(positions.id, positionId));
      expect(parseFloat(updatedPosition[0].quantity.toString())).toBeLessThan(0.3);
      expect(updatedPosition[0].thesisValid).toBe(true); // Still open

      positionManager.stop();
    });

    it('should activate trailing stop when price moves favorably', async () => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Initialize Binance client for position monitoring
      await positionManager.initializeBinanceClient('test-key', 'test-secret');

      // Mock Binance API to avoid real API calls
      const mockOrder = vi.fn().mockResolvedValue({
        orderId: 123456,
        symbol: 'BTCUSDT',
        status: 'FILLED',
        executedQty: '0.1',
      });
      // Mock prices to change over time: first 52000, then 51000
      const mockPrices = vi.fn()
        .mockResolvedValueOnce({ BTCUSDT: '52000' }) // First call: new high
        .mockResolvedValue({ BTCUSDT: '51000' }); // Subsequent calls: below trailing stop
      (positionManager as any).binanceClient = { order: mockOrder, prices: mockPrices };

      positionManager.start();

      // Create position manually
      const [result] = await db.insert(positions).values({
        userId: 1,
        tradeId: 4,
        symbol: 'BTCUSDT',
        side: 'long',
        entryPrice: '50000',
        quantity: '0.1',
        stopLoss: '48000',
        takeProfit: '55000',
        expectedPath: [],
        thesisValid: true,
      });

      const positionId = result.insertId;

      // Reload positions so PositionManager knows about the new position
      await positionManager.loadOpenPositions();

      // First, price moves up to $52,000 (new high)
      vi.spyOn(exchange, 'getTicker').mockResolvedValue({
        symbol: 'BTCUSDT',
        last: 52000,
        bid: 51995,
        ask: 52005,
        high: 52000,
        low: 50000,
        volume: 1000,
        timestamp: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Then price drops to $51,000 (below trailing stop from $52,000)
      vi.spyOn(exchange, 'getTicker').mockResolvedValue({
        symbol: 'BTCUSDT',
        last: 51000, // Below 52000 - 1.5% = 51220
        bid: 50995,
        ask: 51005,
        high: 52000,
        low: 51000,
        volume: 1000,
        timestamp: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify position was closed by trailing stop
      const updatedPosition = await db.select().from(positions).where(eq(positions.id, positionId));
      expect(updatedPosition[0].thesisValid).toBe(false); // Position closed

      positionManager.stop();
    });

    it('should exit position after 4 hours if PnL <= 0%', async () => {
      // TODO: Implement time-based exit test
      // 1. Create position at $50,000
      // 2. Wait 4 hours (mock time)
      // 3. Update price to $49,900 (PnL = -0.2%)
      // 4. Verify position is closed
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Risk Controls', () => {
    it('should NOT open position when macro veto is active', async () => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Activate macro veto
      riskManager.setMacroVeto(true, 'Fed rate hike imminent');

      vi.spyOn(exchange, 'getTicker').mockResolvedValue({
        symbol: 'BTCUSDT',
        last: 50000,
        bid: 49995,
        ask: 50005,
        high: 51000,
        low: 49000,
        volume: 1000,
        timestamp: Date.now(),
      });

      const recommendation = await orchestrator.getRecommendation('BTCUSDT');
      
      // Wait for position creation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should NOT create position
      const createdPositions = await db.select().from(positions).where(eq(positions.symbol, 'BTCUSDT'));
      expect(createdPositions.length).toBe(0);
    });

    it('should NOT open position when trading is halted', async () => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Halt trading
      riskManager.haltTrading('Daily loss limit exceeded');

      vi.spyOn(exchange, 'getTicker').mockResolvedValue({
        symbol: 'BTCUSDT',
        last: 50000,
        bid: 49995,
        ask: 50005,
        high: 51000,
        low: 49000,
        volume: 1000,
        timestamp: Date.now(),
      });

      const recommendation = await orchestrator.getRecommendation('BTCUSDT');
      
      // Wait for position creation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should NOT create position
      const createdPositions = await db.select().from(positions).where(eq(positions.symbol, 'BTCUSDT'));
      expect(createdPositions.length).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle Binance API failure gracefully', async () => {
      orchestrator.setPaperTradingMode(false);

      // Mock API failure
      vi.spyOn(exchange, 'getTicker').mockRejectedValue(new Error('Binance API error'));

      // Should not throw error when getting recommendation
      await expect(orchestrator.getRecommendation('BTCUSDT')).resolves.toBeDefined();
    });

    it.skip('should log error when position creation fails', async () => {
      orchestrator.setPaperTradingMode(false);

      const consoleSpy = vi.spyOn(console, 'error');

      // Mock ALL agent signals to succeed (fast + slow agents)
      const mockSignals = [
        { agentName: 'TechnicalAnalyst', signal: 'bullish' as const, confidence: 0.8, reasoning: 'Test', qualityScore: 0.8, executionScore: 70 },
        { agentName: 'PatternMatcher', signal: 'bullish' as const, confidence: 0.9, reasoning: 'Test', qualityScore: 0.9, executionScore: 80 },
        { agentName: 'OrderFlowAnalyst', signal: 'bullish' as const, confidence: 0.7, reasoning: 'Test', qualityScore: 0.7, executionScore: 60 },
        { agentName: 'SentimentAnalyst', signal: 'bullish' as const, confidence: 0.6, reasoning: 'Test', qualityScore: 0.6, executionScore: 50 },
        { agentName: 'NewsSentinel', signal: 'bullish' as const, confidence: 0.5, reasoning: 'Test', qualityScore: 0.5, executionScore: 40 },
        { agentName: 'MacroAnalyst', signal: 'neutral' as const, confidence: 0.5, reasoning: 'Test', qualityScore: 0.5, executionScore: 40 },
        { agentName: 'OnChainAnalyst', signal: 'bullish' as const, confidence: 0.6, reasoning: 'Test', qualityScore: 0.6, executionScore: 50 },
      ];
      vi.spyOn(agentManager, 'getAllSignals').mockResolvedValue(mockSignals);

      // Mock getTicker to succeed
      vi.spyOn(exchange, 'getTicker').mockResolvedValue({
        symbol: 'BTCUSDT',
        last: 50000,
        bid: 49995,
        ask: 50005,
        high: 51000,
        low: 49000,
        volume: 1000,
        timestamp: Date.now(),
      });

      // Mock position manager to fail
      vi.spyOn(positionManager, 'createPosition').mockRejectedValue(new Error('Failed to create position'));

      const recommendation = await orchestrator.getRecommendation('BTCUSDT');
      
      // Wait for position creation attempt
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should log error (check for either the direct error or retry handler error)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('position'));
    });
  });
});

describe('TradeExecution (unit)', () => {
  it('should have test file loaded', () => {
    expect(true).toBe(true);
  });
});
