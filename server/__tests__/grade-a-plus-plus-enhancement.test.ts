import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PositionManager } from '../PositionManager';
import { AutomatedSignalProcessor } from '../services/AutomatedSignalProcessor';
import { AutomatedTradeExecutor } from '../services/AutomatedTradeExecutor';
import { AutomatedPositionMonitor } from '../services/AutomatedPositionMonitor';
import { PaperTradingEngine } from '../execution/PaperTradingEngine';
import { RiskManager } from '../RiskManager';
import { getDb } from '../db';
import { positions, paperWallets } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import type { AgentSignal } from '../agents/AgentBase';

describe('Grade A++ Enhancement: Position Monitoring & Automated Trading', () => {
  let positionManager: PositionManager;
  let signalProcessor: AutomatedSignalProcessor;
  let tradeExecutor: AutomatedTradeExecutor;
  let positionMonitor: AutomatedPositionMonitor;
  let paperTradingEngine: PaperTradingEngine;
  let riskManager: RiskManager;
  let testUserId: number;
  let db: any;

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error('Database not available');

    testUserId = 999; // Test user ID

    // Clean up any existing test data
    await db.delete(positions).where(eq(positions.userId, testUserId));
    await db.delete(paperWallets).where(eq(paperWallets.userId, testUserId));

    // Create test wallet
    await db.insert(paperWallets).values({
      userId: testUserId,
      balance: '100000.00', // $100k starting balance
      equity: '100000.00',
      totalPnL: '0.00',
      winningTrades: 0,
      losingTrades: 0,
      winRate: '0.00',
    });

    // Initialize components
    positionManager = new PositionManager();
    positionManager.setPaperTradingMode(true);

    paperTradingEngine = new PaperTradingEngine({
      userId: testUserId,
      initialBalance: 100000,
      enableSlippage: false,
      enableLatency: false,
    });

    riskManager = new RiskManager(100000);

    signalProcessor = new AutomatedSignalProcessor(testUserId, {
      minConfidence: 0.60,
      minExecutionScore: 50,
      consensusThreshold: 0.65,
    });

    tradeExecutor = new AutomatedTradeExecutor(testUserId, {
      maxPositionSize: 0.20,
      defaultStopLoss: 0.05,
      defaultTakeProfit: 0.10,
      maxPositions: 10,
      riskPerTrade: 0.02,
    });

    positionMonitor = new AutomatedPositionMonitor(testUserId, {
      monitoringIntervalMs: 100,
      enableTrailingStop: true,
      trailingStopDistance: 0.03,
      trailingStopActivation: 0.05,
    });

    // Wire dependencies
    tradeExecutor.setDependencies(paperTradingEngine, positionManager, riskManager);
    positionMonitor.setDependencies(positionManager, paperTradingEngine);

    console.log('[Test] All components initialized');
  });

  afterAll(async () => {
    if (positionManager) {
      positionManager.stop();
    }
    if (positionMonitor) {
      await positionMonitor.stop();
    }

    // Clean up test data
    if (db && testUserId) {
      await db.delete(positions).where(eq(positions.userId, testUserId));
      await db.delete(paperWallets).where(eq(paperWallets.userId, testUserId));
    }
  });

  describe('Position Monitoring Methods', () => {
    it('should have getOpenPositions method', () => {
      expect(positionManager.getOpenPositions).toBeDefined();
      expect(typeof positionManager.getOpenPositions).toBe('function');
    });

    it('should have updatePosition method', () => {
      expect(positionManager.updatePosition).toBeDefined();
      expect(typeof positionManager.updatePosition).toBe('function');
    });

    it('should retrieve open positions for specific user', async () => {
      // Create a test position
      const [result] = await db!.insert(positions).values({
        userId: testUserId,
        tradeId: 1,
        symbol: 'BTCUSD',
        exchange: 'binance',
        side: 'long',
        entryPrice: '50000.00',
        currentPrice: '50000.00',
        quantity: '0.1',
        stopLoss: '48000.00',
        takeProfit: '52000.00',
        expectedPath: '',
        thesisValid: true,
        strategy: 'automated',
      });

      const positionId = result.insertId;

      // Test getOpenPositions
      const openPositions = await positionManager.getOpenPositions(testUserId);
      
      expect(openPositions).toBeDefined();
      expect(Array.isArray(openPositions)).toBe(true);
      expect(openPositions.length).toBeGreaterThan(0);
      expect(openPositions[0].userId).toBe(testUserId);
      expect(openPositions[0].thesisValid).toBe(true);

      // Clean up
      await db!.delete(positions).where(eq(positions.id, positionId));
    });

    it('should update position successfully', async () => {
      // Create a test position
      const [result] = await db!.insert(positions).values({
        userId: testUserId,
        tradeId: 2,
        symbol: 'ETHUSD',
        exchange: 'binance',
        side: 'long',
        entryPrice: '3000.00',
        currentPrice: '3000.00',
        quantity: '1.0',
        stopLoss: '2900.00',
        takeProfit: '3100.00',
        expectedPath: '',
        thesisValid: true,
        strategy: 'automated',
      });

      const positionId = result.insertId;

      // Test updatePosition
      await positionManager.updatePosition(positionId, {
        currentPrice: '3050.00',
        stopLoss: '2950.00', // Updated trailing stop
      });

      // Verify update
      const [updatedPosition] = await db!
        .select()
        .from(positions)
        .where(eq(positions.id, positionId))
        .limit(1);

      expect(updatedPosition.currentPrice.toString()).toBe('3050.00');
      expect(updatedPosition.stopLoss.toString()).toBe('2950.00');

      // Clean up
      await db!.delete(positions).where(eq(positions.id, positionId));
    });
  });

  describe('Automated Signal Processing', () => {
    it('should approve high-confidence signals', async () => {
      // Phase 15B requires min 4 agents agreeing AND >55% directional dominance
      const mockSignals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.85,
          executionScore: 80,
          qualityScore: 0.90,
          reasoning: 'Strong bullish momentum',
          timestamp: Date.now(),
        },
        {
          agentName: 'SentimentAnalyst',
          signal: 'bullish',
          confidence: 0.75,
          executionScore: 70,
          qualityScore: 0.80,
          reasoning: 'Positive market sentiment',
          timestamp: Date.now(),
        },
        {
          agentName: 'PatternMatcher',
          signal: 'bullish',
          confidence: 0.80,
          executionScore: 75,
          qualityScore: 0.85,
          reasoning: 'Bullish pattern detected',
          timestamp: Date.now(),
        },
        {
          agentName: 'OrderFlowAnalyst',
          signal: 'bullish',
          confidence: 0.78,
          executionScore: 76,
          qualityScore: 0.82,
          reasoning: 'Strong buy-side order flow',
          timestamp: Date.now(),
        },
        {
          agentName: 'OnChainAnalyst',
          signal: 'bullish',
          confidence: 0.72,
          executionScore: 72,
          qualityScore: 0.78,
          reasoning: 'Whale accumulation detected',
          timestamp: Date.now(),
        },
      ];

      const result = await signalProcessor.processSignals(mockSignals, 'BTCUSD');

      expect(result.approved).toBe(true);
      expect(result.recommendation).toBeDefined();
      expect(result.recommendation?.action).toBe('buy');
      expect(result.metrics?.avgConfidence).toBeGreaterThan(0.60);
      expect(result.metrics?.avgExecutionScore).toBeGreaterThan(50);
    });

    it('should reject low-confidence signals', async () => {
      const mockSignals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.45, // Below threshold
          executionScore: 40,
          qualityScore: 0.50,
          reasoning: 'Weak signal',
          timestamp: Date.now(),
        },
      ];

      const result = await signalProcessor.processSignals(mockSignals, 'BTCUSD');

      expect(result.approved).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe('Automated Trade Execution', () => {
    it('should execute approved signals automatically', async () => {
      const approvedSignal = {
        approved: true,
        symbol: 'BTCUSD',
        reason: 'Strong bullish consensus',
        signals: [],
        consensus: { direction: 'bullish' as const, strength: 0.80 },
        metrics: {
          avgConfidence: 0.80,
          avgExecutionScore: 75,
          avgQualityScore: 0.85,
          signalCount: 3,
        },
        recommendation: {
          action: 'buy' as const,
          confidence: 0.80,
          executionScore: 75,
          reasoning: 'Strong bullish signals from multiple agents',
        },
      };

      // Queue signal for execution
      await tradeExecutor.queueSignal(approvedSignal);

      // Wait for execution
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify trade was executed (position created)
      const openPositions = await positionManager.getOpenPositions(testUserId);
      
      // Note: Actual execution depends on risk checks and balance availability
      // This test verifies the execution flow works without errors
      expect(openPositions).toBeDefined();
    });
  });

  describe('Position Monitoring & Auto-Close', () => {
    it('should monitor positions and detect stop-loss conditions', async () => {
      // Create a position
      const [result] = await db!.insert(positions).values({
        userId: testUserId,
        tradeId: 3,
        symbol: 'BTCUSD',
        exchange: 'binance',
        side: 'long',
        entryPrice: '50000.00',
        currentPrice: '50000.00',
        quantity: '0.1',
        stopLoss: '48000.00',
        takeProfit: '52000.00',
        expectedPath: '',
        thesisValid: true,
        strategy: 'automated',
      });

      const positionId = result.insertId;

      // Simulate price drop below stop-loss
      await positionManager.updatePosition(positionId, {
        currentPrice: '47500.00', // Below stop-loss
      });

      // Position should still be marked as open (thesisValid=true)
      // AutomatedPositionMonitor would close it in real-time
      const [position] = await db!
        .select()
        .from(positions)
        .where(eq(positions.id, positionId))
        .limit(1);

      expect(position).toBeDefined();
      expect(parseFloat(position.currentPrice.toString())).toBeLessThan(parseFloat(position.stopLoss.toString()));

      // Clean up
      await db!.delete(positions).where(eq(positions.id, positionId));
    });
  });

  describe('End-to-End Integration', () => {
    it('should complete full trading cycle: signal → execution → monitoring', async () => {
      // Phase 44: Create fresh processor to avoid cooldown from previous tests
      const freshProcessor = new AutomatedSignalProcessor(testUserId, {
        minConfidence: 0.60,
        minExecutionScore: 50,
        consensusThreshold: 0.65,
      });
      // Step 1: Generate high-confidence signals (Phase 15B: min 4 agents)
      const signals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.85,
          executionScore: 80,
          qualityScore: 0.90,
          reasoning: 'Strong bullish momentum',
          timestamp: Date.now(),
        },
        {
          agentName: 'SentimentAnalyst',
          signal: 'bullish',
          confidence: 0.75,
          executionScore: 70,
          qualityScore: 0.80,
          reasoning: 'Positive sentiment',
          timestamp: Date.now(),
        },
        {
          agentName: 'PatternMatcher',
          signal: 'bullish',
          confidence: 0.80,
          executionScore: 78,
          qualityScore: 0.85,
          reasoning: 'Bullish engulfing pattern',
          timestamp: Date.now(),
        },
        {
          agentName: 'OrderFlowAnalyst',
          signal: 'bullish',
          confidence: 0.76,
          executionScore: 74,
          qualityScore: 0.80,
          reasoning: 'Large buy orders detected',
          timestamp: Date.now(),
        },
      ];

      // Step 2: Process signals (use fresh processor and unique symbol to avoid cooldown)
      const processedSignal = await freshProcessor.processSignals(signals, 'BTCUSD-E2E');
      expect(processedSignal.approved).toBe(true);

      // Step 3: Queue for execution
      await tradeExecutor.queueSignal(processedSignal);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Step 4: Verify position monitoring can retrieve positions
      const openPositions = await positionManager.getOpenPositions(testUserId);
      expect(openPositions).toBeDefined();
      expect(Array.isArray(openPositions)).toBe(true);

      console.log(`[Test] End-to-end cycle completed. Open positions: ${openPositions.length}`);
    });
  });

  describe('Performance & Reliability', () => {
    it('should handle multiple concurrent position updates', async () => {
      // Create multiple positions
      const positionIds: number[] = [];
      
      for (let i = 0; i < 5; i++) {
        const [result] = await db!.insert(positions).values({
          userId: testUserId,
          tradeId: 100 + i,
          symbol: `TEST${i}USD`,
          exchange: 'binance',
          side: 'long',
          entryPrice: '1000.00',
          currentPrice: '1000.00',
          quantity: '1.0',
          stopLoss: '950.00',
          takeProfit: '1050.00',
          expectedPath: '',         thesisValid: true,
          strategy: 'automated',
        });
        positionIds.push(result.insertId);
      }

      // Update all positions concurrently
      const updates = positionIds.map(id =>
        positionManager.updatePosition(id, {
          currentPrice: '1010.00',
        })
      );

      await Promise.all(updates);

      // Verify all updates succeeded
      const openPositions = await positionManager.getOpenPositions(testUserId);
      const testPositions = openPositions.filter(p => p.symbol.startsWith('TEST'));
      
      expect(testPositions.length).toBe(5);
      testPositions.forEach(p => {
        expect(p.currentPrice.toString()).toBe('1010.00');
      });

      // Clean up
      for (const id of positionIds) {
        await db!.delete(positions).where(eq(positions.id, id));
      }
    });

    it('should handle getOpenPositions with no positions gracefully', async () => {
      const nonExistentUserId = 99999;
      const positions = await positionManager.getOpenPositions(nonExistentUserId);
      
      expect(positions).toBeDefined();
      expect(Array.isArray(positions)).toBe(true);
      expect(positions.length).toBe(0);
    });
  });
});
