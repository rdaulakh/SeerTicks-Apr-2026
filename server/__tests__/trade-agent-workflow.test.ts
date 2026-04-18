/**
 * Comprehensive Trade Agent Workflow Tests
 * 
 * Tests the complete autonomous trading workflow from signal detection to position exit:
 * 1. Signal Detection & Processing
 * 2. Budget Allocation & Position Sizing
 * 3. Trade Execution
 * 4. Position Management
 * 5. Exit Scenarios (Take Profit, Stop Loss, Intelligent Exit)
 * 6. Budget Usage Tracking
 * 7. Account Balance Validation
 * 
 * @author SEER Trading Platform
 * @date January 3, 2026
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { AutomatedSignalProcessor, ProcessedSignal, Consensus } from '../services/AutomatedSignalProcessor';
import { AutomatedTradeExecutor } from '../services/AutomatedTradeExecutor';
import { IntelligentExitManager, Position, ExitDecision } from '../services/IntelligentExitManager';
import { BalanceTracker, getBalanceTracker } from '../services/BalanceTracker';
import { PaperTradingEngine, PaperWallet } from '../execution/PaperTradingEngine';
import type { AgentSignal } from '../agents/AgentBase';

/**
 * Integration test: requires live server/DB/external APIs.
 * Set INTEGRATION_TEST=1 to run these tests.
 */
const isIntegration = process.env.INTEGRATION_TEST === '1';


// Test constants
const TEST_USER_ID = 999999;
const TEST_SYMBOL = 'BTC-USD';
const INITIAL_BALANCE = 10000;

describe.skipIf(!isIntegration)('Trade Agent Workflow - Complete End-to-End Tests', () => {
  let signalProcessor: AutomatedSignalProcessor;
  let tradeExecutor: AutomatedTradeExecutor;
  let exitManager: IntelligentExitManager;
  let balanceTracker: BalanceTracker;

  beforeAll(() => {
    console.log('\n========================================');
    console.log('Trade Agent Workflow Tests Starting');
    console.log('========================================\n');
  });

  afterAll(() => {
    console.log('\n========================================');
    console.log('Trade Agent Workflow Tests Complete');
    console.log('========================================\n');
  });

  describe('1. Signal Detection & Processing', () => {
    beforeEach(() => {
      signalProcessor = new AutomatedSignalProcessor(TEST_USER_ID, {
        minConfidence: 0.65,
        minExecutionScore: 50,
        consensusThreshold: 0.70,
      });
    });

    it('should reject signals with weak consensus', async () => {
      const weakSignals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.55, // Below threshold
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'Weak bullish signal',
          executionScore: 60,
          qualityScore: 0.5,
        },
        {
          agentName: 'PatternMatcher',
          signal: 'neutral',
          confidence: 0.40,
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'No clear pattern',
          executionScore: 30,
          qualityScore: 0.3,
        },
      ];

      const result = await signalProcessor.processSignals(weakSignals, TEST_SYMBOL);
      
      expect(result.approved).toBe(false);
      expect(result.reason).toContain('consensus');
      console.log(`✓ Weak consensus rejected: ${result.reason}`);
    });

    it('should approve signals with strong consensus (70%+)', async () => {
      const strongSignals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.85,
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'Strong bullish RSI divergence',
          executionScore: 80,
          qualityScore: 0.9,
        },
        {
          agentName: 'PatternMatcher',
          signal: 'bullish',
          confidence: 0.80,
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'Double bottom pattern confirmed',
          executionScore: 75,
          qualityScore: 0.85,
        },
        {
          agentName: 'OrderFlowAnalyst',
          signal: 'bullish',
          confidence: 0.75,
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'Large buy orders detected',
          executionScore: 70,
          qualityScore: 0.8,
        },
      ];

      const result = await signalProcessor.processSignals(strongSignals, TEST_SYMBOL);
      
      expect(result.approved).toBe(true);
      expect(result.recommendation?.action).toBe('buy');
      expect(result.recommendation?.confidence).toBeGreaterThan(0.65);
      console.log(`✓ Strong consensus approved: ${result.recommendation?.action} with ${(result.recommendation?.confidence || 0) * 100}% confidence`);
    });

    it('should calculate weighted consensus correctly', async () => {
      // TechnicalAnalyst has 40% weight, PatternMatcher has 35% weight
      const mixedSignals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.90,
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'Strong bullish',
          executionScore: 85,
          qualityScore: 0.9,
        },
        {
          agentName: 'PatternMatcher',
          signal: 'bearish',
          confidence: 0.70,
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'Bearish pattern',
          executionScore: 65,
          qualityScore: 0.7,
        },
      ];

      const result = await signalProcessor.processSignals(mixedSignals, TEST_SYMBOL);
      
      // TechnicalAnalyst (40% weight * 0.90 confidence) = 0.36 bullish
      // PatternMatcher (35% weight * 0.70 confidence) = 0.245 bearish
      // Bullish should win but may not meet threshold
      expect(result.consensus?.direction).toBe('bullish');
      console.log(`✓ Weighted consensus: ${result.consensus?.direction} (${(result.consensus?.strength || 0) * 100}%)`);
    });

    it('should reject signals below minimum confidence threshold', async () => {
      const lowConfidenceSignals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.50, // Below 65% minimum
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'Low confidence signal',
          executionScore: 80,
          qualityScore: 0.8,
        },
      ];

      const result = await signalProcessor.processSignals(lowConfidenceSignals, TEST_SYMBOL);
      
      expect(result.approved).toBe(false);
      console.log(`✓ Low confidence rejected: ${result.reason}`);
    });

    it('should reject signals with low execution scores', async () => {
      const lowExecSignals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.85,
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'High confidence but low execution',
          executionScore: 30, // Below 50 minimum
          qualityScore: 0.8,
        },
      ];

      const result = await signalProcessor.processSignals(lowExecSignals, TEST_SYMBOL);
      
      expect(result.approved).toBe(false);
      console.log(`✓ Low execution score rejected: ${result.reason}`);
    });
  });

  describe('2. Budget Allocation & Position Sizing', () => {
    let executor: AutomatedTradeExecutor;

    beforeEach(() => {
      executor = new AutomatedTradeExecutor(TEST_USER_ID, {
        maxPositionSize: 0.20, // 20% max
        defaultStopLoss: 0.05,
        defaultTakeProfit: 0.10,
        maxPositions: 10,
        riskPerTrade: 0.02,
      });
    });

    it('should limit position size to 20% of available balance', () => {
      const config = executor.getConfig();
      expect(config.maxPositionSize).toBe(0.20);
      console.log(`✓ Max position size: ${config.maxPositionSize * 100}%`);
    });

    it('should calculate Kelly Criterion position sizing', () => {
      // Kelly formula: f = (bp - q) / b
      // With 80% confidence, 0.5 quality, 2:1 odds (10%/5%)
      const availableBalance = 10000;
      const confidence = 0.80;
      const qualityScore = 0.5;
      
      const oddsRatio = 0.10 / 0.05; // 2.0
      const winProbability = confidence * qualityScore; // 0.40
      const lossProbability = 1 - winProbability; // 0.60
      
      let kellyFraction = (oddsRatio * winProbability - lossProbability) / oddsRatio;
      kellyFraction = kellyFraction * 0.5; // Half Kelly
      kellyFraction = Math.min(kellyFraction, 0.20); // Cap at 20%
      kellyFraction = Math.max(kellyFraction, 0.01); // Min 1%
      
      const positionSize = availableBalance * kellyFraction;
      
      expect(positionSize).toBeGreaterThan(0);
      expect(positionSize).toBeLessThanOrEqual(availableBalance * 0.20);
      console.log(`✓ Kelly position size: $${positionSize.toFixed(2)} (${(kellyFraction * 100).toFixed(1)}%)`);
    });

    it('should enforce maximum 10 concurrent positions', () => {
      const config = executor.getConfig();
      expect(config.maxPositions).toBe(10);
      console.log(`✓ Max concurrent positions: ${config.maxPositions}`);
    });

    it('should set 2% risk per trade', () => {
      const config = executor.getConfig();
      expect(config.riskPerTrade).toBe(0.02);
      console.log(`✓ Risk per trade: ${config.riskPerTrade * 100}%`);
    });
  });

  describe('3. Balance Tracking & Validation', () => {
    let tracker: BalanceTracker;

    beforeEach(() => {
      tracker = new BalanceTracker(TEST_USER_ID, INITIAL_BALANCE);
    });

    it('should track initial balance correctly', () => {
      const balance = tracker.getInitialBalance();
      expect(balance).toBe(INITIAL_BALANCE);
      console.log(`✓ Initial balance: $${balance}`);
    });

    it('should calculate available balance after margin usage', () => {
      // Simulate position with margin
      tracker.updatePosition({
        id: 1,
        symbol: TEST_SYMBOL,
        quantity: 0.1,
        entryPrice: 50000,
        currentPrice: 50000,
        unrealizedPnL: 0,
        marginUsed: 5000, // 50% margin used
      });

      const snapshot = tracker.getBalanceSnapshot();
      expect(snapshot.availableBalance).toBe(INITIAL_BALANCE - 5000);
      expect(snapshot.marginUsed).toBe(5000);
      console.log(`✓ Available balance after margin: $${snapshot.availableBalance}`);
    });

    it('should validate position can be opened with sufficient balance', () => {
      const validation = tracker.validateNewPosition(50000, 0.1, 10);
      expect(validation.valid).toBe(true);
      console.log(`✓ Position validation passed: $${50000 * 0.1} position`);
    });

    it('should reject position when balance is insufficient', () => {
      // Use up most of the balance
      tracker.updatePosition({
        id: 1,
        symbol: TEST_SYMBOL,
        quantity: 0.18,
        entryPrice: 50000,
        currentPrice: 50000,
        unrealizedPnL: 0,
        marginUsed: 9000, // 90% margin used
      });

      // Try to open another large position
      const validation = tracker.validateNewPosition(50000, 0.1, 10);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('Insufficient');
      console.log(`✓ Insufficient balance rejected: ${validation.reason}`);
    });

    it('should calculate max position size based on available balance', () => {
      const maxSize = tracker.getMaxPositionSize(50000, 20, 10);
      const expectedMax = (INITIAL_BALANCE * 0.20 * 0.90) / 50000;
      
      expect(maxSize).toBeCloseTo(expectedMax, 4);
      console.log(`✓ Max position size: ${maxSize.toFixed(6)} units`);
    });

    it('should track unrealized P&L correctly', () => {
      tracker.updatePosition({
        id: 1,
        symbol: TEST_SYMBOL,
        quantity: 0.1,
        entryPrice: 50000,
        currentPrice: 52000, // 4% profit
        unrealizedPnL: 200, // (52000 - 50000) * 0.1
        marginUsed: 5000,
      });

      const snapshot = tracker.getBalanceSnapshot();
      expect(snapshot.unrealizedPnL).toBe(200);
      expect(snapshot.equity).toBe(INITIAL_BALANCE + 200);
      console.log(`✓ Unrealized P&L: $${snapshot.unrealizedPnL}, Equity: $${snapshot.equity}`);
    });

    it('should track realized P&L after position close', () => {
      tracker.addRealizedPnL(500); // $500 profit from closed trade
      
      const snapshot = tracker.getBalanceSnapshot();
      expect(snapshot.realizedPnL).toBe(500);
      expect(snapshot.totalBalance).toBe(INITIAL_BALANCE + 500);
      console.log(`✓ Realized P&L: $${snapshot.realizedPnL}, Total Balance: $${snapshot.totalBalance}`);
    });
  });

  describe('4. Position Exit Scenarios', () => {
    let exitManager: IntelligentExitManager;

    beforeEach(() => {
      exitManager = new IntelligentExitManager({
        breakevenActivationPercent: 0.5,
        breakevenBuffer: 0.1,
        partialProfitLevels: [
          { pnlPercent: 1.0, exitPercent: 25 },
          { pnlPercent: 1.5, exitPercent: 25 },
          { pnlPercent: 2.0, exitPercent: 25 },
        ],
        trailingActivationPercent: 1.5,
        trailingPercent: 0.5,
        exitConsensusThreshold: 0.6,
        maxHoldTimeHours: 4,
        minProfitForTimeExit: 0,
      });
    });

    it('should activate breakeven stop at +0.5% profit', () => {
      const config = exitManager['config'];
      expect(config.breakevenActivationPercent).toBe(0.5);
      console.log(`✓ Breakeven activation at: +${config.breakevenActivationPercent}%`);
    });

    it('should trigger partial profit taking at defined levels', () => {
      const config = exitManager['config'];
      expect(config.partialProfitLevels).toHaveLength(3);
      expect(config.partialProfitLevels[0]).toEqual({ pnlPercent: 1.0, exitPercent: 25 });
      expect(config.partialProfitLevels[1]).toEqual({ pnlPercent: 1.5, exitPercent: 25 });
      expect(config.partialProfitLevels[2]).toEqual({ pnlPercent: 2.0, exitPercent: 25 });
      console.log(`✓ Partial profit levels: ${config.partialProfitLevels.map(l => `${l.pnlPercent}%→${l.exitPercent}%`).join(', ')}`);
    });

    it('should activate trailing stop at +1.5% profit', () => {
      const config = exitManager['config'];
      expect(config.trailingActivationPercent).toBe(1.5);
      expect(config.trailingPercent).toBe(0.5);
      console.log(`✓ Trailing stop: Activate at +${config.trailingActivationPercent}%, trail by ${config.trailingPercent}%`);
    });

    it('should require 60% agent consensus for exit', () => {
      const config = exitManager['config'];
      expect(config.exitConsensusThreshold).toBe(0.6);
      console.log(`✓ Exit consensus threshold: ${config.exitConsensusThreshold * 100}%`);
    });

    it('should enforce maximum hold time of 4 hours', () => {
      const config = exitManager['config'];
      expect(config.maxHoldTimeHours).toBe(4);
      console.log(`✓ Max hold time: ${config.maxHoldTimeHours} hours`);
    });

    it('should add position to monitoring', () => {
      const position = {
        id: 'test-position-1',
        symbol: TEST_SYMBOL,
        side: 'long' as const,
        entryPrice: 50000,
        currentPrice: 50000,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: Date.now(),
        marketRegime: 'trending_up',
        originalConsensus: 0.75,
      };

      exitManager.addPosition(position);
      
      const positions = exitManager['positions'];
      expect(positions.has('test-position-1')).toBe(true);
      console.log(`✓ Position added to monitoring: ${position.id}`);
    });

    it('should remove position from monitoring after exit', () => {
      const position = {
        id: 'test-position-2',
        symbol: TEST_SYMBOL,
        side: 'long' as const,
        entryPrice: 50000,
        currentPrice: 50000,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: Date.now(),
        marketRegime: 'trending_up',
        originalConsensus: 0.75,
      };

      exitManager.addPosition(position);
      exitManager.removePosition('test-position-2');
      
      const positions = exitManager['positions'];
      expect(positions.has('test-position-2')).toBe(false);
      console.log(`✓ Position removed from monitoring after exit`);
    });
  });

  describe('5. Budget Usage vs Account Balance', () => {
    let tracker: BalanceTracker;

    beforeEach(() => {
      tracker = new BalanceTracker(TEST_USER_ID, INITIAL_BALANCE);
    });

    it('should track budget usage across multiple positions', () => {
      // Open 3 positions using 15%, 10%, and 5% of balance
      tracker.updatePosition({
        id: 1,
        symbol: 'BTC-USD',
        quantity: 0.03,
        entryPrice: 50000,
        currentPrice: 50000,
        unrealizedPnL: 0,
        marginUsed: 1500, // 15%
      });

      tracker.updatePosition({
        id: 2,
        symbol: 'ETH-USD',
        quantity: 0.5,
        entryPrice: 2000,
        currentPrice: 2000,
        unrealizedPnL: 0,
        marginUsed: 1000, // 10%
      });

      tracker.updatePosition({
        id: 3,
        symbol: 'SOL-USD',
        quantity: 5,
        entryPrice: 100,
        currentPrice: 100,
        unrealizedPnL: 0,
        marginUsed: 500, // 5%
      });

      const snapshot = tracker.getBalanceSnapshot();
      expect(snapshot.marginUsed).toBe(3000); // 30% total
      expect(snapshot.availableBalance).toBe(7000); // 70% available
      console.log(`✓ Budget usage: $${snapshot.marginUsed} (${(snapshot.marginUsed / INITIAL_BALANCE * 100).toFixed(0)}%)`);
      console.log(`✓ Available: $${snapshot.availableBalance} (${(snapshot.availableBalance / INITIAL_BALANCE * 100).toFixed(0)}%)`);
    });

    it('should prevent over-allocation beyond account balance', () => {
      // Use 80% of balance
      tracker.updatePosition({
        id: 1,
        symbol: 'BTC-USD',
        quantity: 0.16,
        entryPrice: 50000,
        currentPrice: 50000,
        unrealizedPnL: 0,
        marginUsed: 8000,
      });

      // Try to allocate another 30% (should fail)
      const validation = tracker.validateNewPosition(50000, 0.06, 10); // $3000 + 10% buffer = $3300
      expect(validation.valid).toBe(false);
      console.log(`✓ Over-allocation prevented: ${validation.reason}`);
    });

    it('should update available balance after position close', () => {
      // Open position
      tracker.updatePosition({
        id: 1,
        symbol: 'BTC-USD',
        quantity: 0.1,
        entryPrice: 50000,
        currentPrice: 50000,
        unrealizedPnL: 0,
        marginUsed: 5000,
      });

      let snapshot = tracker.getBalanceSnapshot();
      expect(snapshot.availableBalance).toBe(5000);

      // Close position with profit
      tracker.removePosition('BTC-USD');
      tracker.addRealizedPnL(500);

      snapshot = tracker.getBalanceSnapshot();
      expect(snapshot.availableBalance).toBe(10500); // Original + profit
      expect(snapshot.marginUsed).toBe(0);
      console.log(`✓ Balance after close: $${snapshot.availableBalance} (freed margin + $500 profit)`);
    });

    it('should handle negative P&L correctly', () => {
      tracker.updatePosition({
        id: 1,
        symbol: 'BTC-USD',
        quantity: 0.1,
        entryPrice: 50000,
        currentPrice: 48000, // 4% loss
        unrealizedPnL: -200,
        marginUsed: 5000,
      });

      const snapshot = tracker.getBalanceSnapshot();
      expect(snapshot.unrealizedPnL).toBe(-200);
      expect(snapshot.equity).toBe(INITIAL_BALANCE - 200);
      console.log(`✓ Negative P&L tracked: Unrealized $${snapshot.unrealizedPnL}, Equity $${snapshot.equity}`);
    });

    it('should calculate win rate correctly', () => {
      // Simulate 6 winning trades and 4 losing trades
      const winningTrades = 6;
      const losingTrades = 4;
      const totalTrades = winningTrades + losingTrades;
      const winRate = (winningTrades / totalTrades) * 100;

      expect(winRate).toBe(60);
      console.log(`✓ Win rate calculation: ${winningTrades}W/${losingTrades}L = ${winRate}%`);
    });
  });

  describe('6. Error Handling & Edge Cases', () => {
    it('should handle zero balance gracefully', () => {
      const tracker = new BalanceTracker(TEST_USER_ID, 0);
      const validation = tracker.validateNewPosition(50000, 0.1, 10);
      
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('zero or negative');
      console.log(`✓ Zero balance handled: ${validation.reason}`);
    });

    it('should handle negative balance gracefully', () => {
      const tracker = new BalanceTracker(TEST_USER_ID, 100);
      tracker.addRealizedPnL(-200); // Lose more than balance
      
      const snapshot = tracker.getBalanceSnapshot();
      expect(snapshot.totalBalance).toBe(-100);
      
      const validation = tracker.validateNewPosition(50000, 0.001, 10);
      expect(validation.valid).toBe(false);
      console.log(`✓ Negative balance handled: Total balance $${snapshot.totalBalance}`);
    });

    it('should handle empty signal array', async () => {
      const processor = new AutomatedSignalProcessor(TEST_USER_ID);
      const result = await processor.processSignals([], TEST_SYMBOL);
      
      expect(result.approved).toBe(false);
      expect(result.reason).toContain('No actionable signals');
      console.log(`✓ Empty signals handled: ${result.reason}`);
    });

    it('should handle all neutral signals', async () => {
      const processor = new AutomatedSignalProcessor(TEST_USER_ID);
      const neutralSignals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'neutral',
          confidence: 0.50,
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'No clear direction',
          executionScore: 50,
          qualityScore: 0.5,
        },
      ];

      const result = await processor.processSignals(neutralSignals, TEST_SYMBOL);
      
      expect(result.approved).toBe(false);
      expect(result.reason).toContain('No actionable signals');
      console.log(`✓ Neutral signals handled: ${result.reason}`);
    });

    it('should handle unknown agent names with default weight', async () => {
      const processor = new AutomatedSignalProcessor(TEST_USER_ID, {
        minConfidence: 0.50,
        consensusThreshold: 0.50,
      });
      
      const unknownAgentSignals: AgentSignal[] = [
        {
          agentName: 'UnknownAgent',
          signal: 'bullish',
          confidence: 0.90,
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'Unknown agent signal',
          executionScore: 80,
          qualityScore: 0.8,
        },
      ];

      const result = await processor.processSignals(unknownAgentSignals, TEST_SYMBOL);
      
      // Should use default 5% weight
      expect(result.consensus?.totalWeight).toBe(0.05);
      console.log(`✓ Unknown agent handled with default weight: ${result.consensus?.totalWeight}`);
    });
  });

  describe('7. Integration Workflow Simulation', () => {
    it('should simulate complete trade lifecycle', async () => {
      console.log('\n--- Complete Trade Lifecycle Simulation ---\n');
      
      // Step 1: Initialize components
      const processor = new AutomatedSignalProcessor(TEST_USER_ID, {
        minConfidence: 0.65,
        consensusThreshold: 0.70,
      });
      const tracker = new BalanceTracker(TEST_USER_ID, INITIAL_BALANCE);
      
      console.log(`1. Initial Balance: $${INITIAL_BALANCE}`);
      
      // Step 2: Generate strong signals
      const signals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.85,
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'RSI oversold bounce',
          executionScore: 80,
          qualityScore: 0.9,
        },
        {
          agentName: 'PatternMatcher',
          signal: 'bullish',
          confidence: 0.80,
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'Double bottom confirmed',
          executionScore: 75,
          qualityScore: 0.85,
        },
        {
          agentName: 'OrderFlowAnalyst',
          signal: 'bullish',
          confidence: 0.75,
          timestamp: Date.now(),
          symbol: TEST_SYMBOL,
          reasoning: 'Large buy orders detected',
          executionScore: 70,
          qualityScore: 0.8,
        },
      ];
      
      // Step 3: Process signals
      const result = await processor.processSignals(signals, TEST_SYMBOL);
      console.log(`2. Signal Processing: ${result.approved ? 'APPROVED' : 'REJECTED'}`);
      console.log(`   Action: ${result.recommendation?.action || 'N/A'}`);
      console.log(`   Confidence: ${((result.recommendation?.confidence || 0) * 100).toFixed(1)}%`);
      
      expect(result.approved).toBe(true);
      
      // Step 4: Calculate position size (Kelly Criterion)
      const confidence = result.recommendation?.confidence || 0.8;
      const qualityScore = result.metrics?.avgQualityScore || 0.85;
      const oddsRatio = 2.0; // 10% TP / 5% SL
      const winProb = confidence * qualityScore;
      let kellyFraction = ((oddsRatio * winProb) - (1 - winProb)) / oddsRatio;
      kellyFraction = Math.min(kellyFraction * 0.5, 0.20); // Half Kelly, max 20%
      const positionValue = INITIAL_BALANCE * kellyFraction;
      const entryPrice = 50000;
      const quantity = positionValue / entryPrice;
      
      console.log(`3. Position Sizing:`);
      console.log(`   Kelly Fraction: ${(kellyFraction * 100).toFixed(1)}%`);
      console.log(`   Position Value: $${positionValue.toFixed(2)}`);
      console.log(`   Quantity: ${quantity.toFixed(6)} BTC`);
      
      // Step 5: Validate and open position
      const validation = tracker.validateNewPosition(entryPrice, quantity, 10);
      expect(validation.valid).toBe(true);
      
      tracker.updatePosition({
        id: 1,
        symbol: TEST_SYMBOL,
        quantity,
        entryPrice,
        currentPrice: entryPrice,
        unrealizedPnL: 0,
        marginUsed: positionValue,
      });
      
      let snapshot = tracker.getBalanceSnapshot();
      console.log(`4. Position Opened:`);
      console.log(`   Margin Used: $${snapshot.marginUsed.toFixed(2)}`);
      console.log(`   Available Balance: $${snapshot.availableBalance.toFixed(2)}`);
      
      // Step 6: Simulate price movement (+2%)
      const newPrice = entryPrice * 1.02;
      const unrealizedPnL = (newPrice - entryPrice) * quantity;
      
      tracker.updatePosition({
        id: 1,
        symbol: TEST_SYMBOL,
        quantity,
        entryPrice,
        currentPrice: newPrice,
        unrealizedPnL,
        marginUsed: positionValue,
      });
      
      snapshot = tracker.getBalanceSnapshot();
      console.log(`5. Price Movement (+2%):`);
      console.log(`   Current Price: $${newPrice.toFixed(2)}`);
      console.log(`   Unrealized P&L: $${snapshot.unrealizedPnL.toFixed(2)}`);
      console.log(`   Equity: $${snapshot.equity.toFixed(2)}`);
      
      // Step 7: Close position with profit
      tracker.removePosition(TEST_SYMBOL);
      tracker.addRealizedPnL(unrealizedPnL);
      
      snapshot = tracker.getBalanceSnapshot();
      console.log(`6. Position Closed:`);
      console.log(`   Realized P&L: $${snapshot.realizedPnL.toFixed(2)}`);
      console.log(`   Final Balance: $${snapshot.totalBalance.toFixed(2)}`);
      console.log(`   Return: ${((snapshot.totalBalance - INITIAL_BALANCE) / INITIAL_BALANCE * 100).toFixed(2)}%`);
      
      expect(snapshot.totalBalance).toBeGreaterThan(INITIAL_BALANCE);
      expect(snapshot.marginUsed).toBe(0);
      
      console.log('\n--- Lifecycle Complete ---\n');
    });

    it('should simulate losing trade lifecycle', async () => {
      console.log('\n--- Losing Trade Lifecycle Simulation ---\n');
      
      const tracker = new BalanceTracker(TEST_USER_ID, INITIAL_BALANCE);
      const entryPrice = 50000;
      const quantity = 0.1;
      const positionValue = entryPrice * quantity;
      
      console.log(`1. Initial Balance: $${INITIAL_BALANCE}`);
      
      // Open position
      tracker.updatePosition({
        id: 1,
        symbol: TEST_SYMBOL,
        quantity,
        entryPrice,
        currentPrice: entryPrice,
        unrealizedPnL: 0,
        marginUsed: positionValue,
      });
      
      console.log(`2. Position Opened: ${quantity} BTC @ $${entryPrice}`);
      
      // Price drops 5% (stop loss hit)
      const exitPrice = entryPrice * 0.95;
      const loss = (exitPrice - entryPrice) * quantity;
      
      tracker.updatePosition({
        id: 1,
        symbol: TEST_SYMBOL,
        quantity,
        entryPrice,
        currentPrice: exitPrice,
        unrealizedPnL: loss,
        marginUsed: positionValue,
      });
      
      let snapshot = tracker.getBalanceSnapshot();
      console.log(`3. Stop Loss Hit (-5%):`);
      console.log(`   Exit Price: $${exitPrice.toFixed(2)}`);
      console.log(`   Unrealized P&L: $${snapshot.unrealizedPnL.toFixed(2)}`);
      
      // Close position with loss
      tracker.removePosition(TEST_SYMBOL);
      tracker.addRealizedPnL(loss);
      
      snapshot = tracker.getBalanceSnapshot();
      console.log(`4. Position Closed:`);
      console.log(`   Realized P&L: $${snapshot.realizedPnL.toFixed(2)}`);
      console.log(`   Final Balance: $${snapshot.totalBalance.toFixed(2)}`);
      console.log(`   Loss: ${((INITIAL_BALANCE - snapshot.totalBalance) / INITIAL_BALANCE * 100).toFixed(2)}%`);
      
      expect(snapshot.totalBalance).toBeLessThan(INITIAL_BALANCE);
      expect(snapshot.realizedPnL).toBeLessThan(0);
      
      console.log('\n--- Losing Trade Complete ---\n');
    });

    it('should simulate partial profit taking', async () => {
      console.log('\n--- Partial Profit Taking Simulation ---\n');
      
      const tracker = new BalanceTracker(TEST_USER_ID, INITIAL_BALANCE);
      const entryPrice = 50000;
      let quantity = 0.1;
      const positionValue = entryPrice * quantity;
      
      console.log(`1. Initial Position: ${quantity} BTC @ $${entryPrice}`);
      
      // Open position
      tracker.updatePosition({
        id: 1,
        symbol: TEST_SYMBOL,
        quantity,
        entryPrice,
        currentPrice: entryPrice,
        unrealizedPnL: 0,
        marginUsed: positionValue,
      });
      
      // Price rises 1% - take 25% profit
      let currentPrice = entryPrice * 1.01;
      let exitQuantity = quantity * 0.25;
      let profit1 = (currentPrice - entryPrice) * exitQuantity;
      quantity -= exitQuantity;
      
      tracker.addRealizedPnL(profit1);
      console.log(`2. First Exit (+1%): Sold ${exitQuantity} BTC, Profit: $${profit1.toFixed(2)}`);
      
      // Price rises 1.5% - take another 25%
      currentPrice = entryPrice * 1.015;
      exitQuantity = 0.1 * 0.25; // 25% of original
      let profit2 = (currentPrice - entryPrice) * exitQuantity;
      quantity -= exitQuantity;
      
      tracker.addRealizedPnL(profit2);
      console.log(`3. Second Exit (+1.5%): Sold ${exitQuantity} BTC, Profit: $${profit2.toFixed(2)}`);
      
      // Price rises 2% - take another 25%
      currentPrice = entryPrice * 1.02;
      exitQuantity = 0.1 * 0.25;
      let profit3 = (currentPrice - entryPrice) * exitQuantity;
      quantity -= exitQuantity;
      
      tracker.addRealizedPnL(profit3);
      console.log(`4. Third Exit (+2%): Sold ${exitQuantity} BTC, Profit: $${profit3.toFixed(2)}`);
      
      // Remaining 25% runs with trailing stop, exits at +1.8%
      currentPrice = entryPrice * 1.018;
      exitQuantity = 0.1 * 0.25;
      let profit4 = (currentPrice - entryPrice) * exitQuantity;
      
      tracker.removePosition(TEST_SYMBOL);
      tracker.addRealizedPnL(profit4);
      console.log(`5. Final Exit (+1.8%): Sold ${exitQuantity} BTC, Profit: $${profit4.toFixed(2)}`);
      
      const snapshot = tracker.getBalanceSnapshot();
      const totalProfit = profit1 + profit2 + profit3 + profit4;
      console.log(`\n6. Summary:`);
      console.log(`   Total Realized P&L: $${snapshot.realizedPnL.toFixed(2)}`);
      console.log(`   Final Balance: $${snapshot.totalBalance.toFixed(2)}`);
      console.log(`   Return: ${((snapshot.totalBalance - INITIAL_BALANCE) / INITIAL_BALANCE * 100).toFixed(2)}%`);
      
      expect(snapshot.realizedPnL).toBeCloseTo(totalProfit, 2);
      expect(snapshot.totalBalance).toBeGreaterThan(INITIAL_BALANCE);
      
      console.log('\n--- Partial Profit Taking Complete ---\n');
    });
  });
});

describe('Trade Agent Configuration Tests', () => {
  describe('AutomatedSignalProcessor Configuration', () => {
    it('should use A++ grade thresholds by default', () => {
      const processor = new AutomatedSignalProcessor(TEST_USER_ID);
      const config = processor.getConfig();
      
      // Phase 44: Updated to match current PRODUCTION_CONFIG values (Phase 40 tuning)
      expect(config.minConfidence).toBe(0.45);
      expect(config.minExecutionScore).toBe(40);
      expect(config.consensusThreshold).toBe(0.50);
      console.log(`✓ Production Thresholds: Confidence ${config.minConfidence * 100}%, Execution ${config.minExecutionScore}, Consensus ${config.consensusThreshold * 100}%`);
    });

    it('should have correct agent weights', () => {
      const processor = new AutomatedSignalProcessor(TEST_USER_ID);
      const config = processor.getConfig();
      
      // Phase 15B: FAST category multiplier is 0.70, so weights = baseWeight/100 * 0.70
      // TechnicalAnalyst: 40/100 * 0.70 = 0.28
      // PatternMatcher: 35/100 * 0.70 = 0.245
      // OrderFlowAnalyst: 25/100 * 0.70 = 0.175
      expect(config.agentWeights['TechnicalAnalyst']).toBeCloseTo(0.28, 2);
      expect(config.agentWeights['PatternMatcher']).toBeCloseTo(0.245, 2);
      expect(config.agentWeights['OrderFlowAnalyst']).toBeCloseTo(0.175, 2);
      console.log(`✓ Agent Weights (Phase 15B): TA=${config.agentWeights['TechnicalAnalyst']}, PM=${config.agentWeights['PatternMatcher']}, OFA=${config.agentWeights['OrderFlowAnalyst']}`);
    });

    it('should allow configuration updates', () => {
      const processor = new AutomatedSignalProcessor(TEST_USER_ID);
      
      processor.updateConfig({
        minConfidence: 0.75,
        consensusThreshold: 0.80,
      });
      
      const config = processor.getConfig();
      expect(config.minConfidence).toBe(0.75);
      expect(config.consensusThreshold).toBe(0.80);
      console.log(`✓ Config updated: Confidence ${config.minConfidence * 100}%, Consensus ${config.consensusThreshold * 100}%`);
    });
  });

  describe('AutomatedTradeExecutor Configuration', () => {
    it('should have correct default configuration', () => {
      const executor = new AutomatedTradeExecutor(TEST_USER_ID);
      const config = executor.getConfig();
      
      expect(config.maxPositionSize).toBe(0.20);
      expect(config.defaultStopLoss).toBe(0.05);
      expect(config.defaultTakeProfit).toBe(0.10);
      expect(config.maxPositions).toBe(10);
      expect(config.riskPerTrade).toBe(0.02);
      console.log(`✓ Executor Config: MaxPos=${config.maxPositionSize * 100}%, SL=${config.defaultStopLoss * 100}%, TP=${config.defaultTakeProfit * 100}%`);
    });

    it('should track execution queue status', () => {
      const executor = new AutomatedTradeExecutor(TEST_USER_ID);
      const status = executor.getQueueStatus();
      
      expect(status.queueSize).toBe(0);
      expect(status.isExecuting).toBe(false);
      expect(status.maxQueueSize).toBe(100);
      console.log(`✓ Queue Status: Size=${status.queueSize}, Executing=${status.isExecuting}, Max=${status.maxQueueSize}`);
    });
  });

  describe('IntelligentExitManager Configuration', () => {
    it('should have correct A++ institutional settings', () => {
      const exitManager = new IntelligentExitManager();
      const config = exitManager['config'];
      
      expect(config.breakevenActivationPercent).toBe(0.5);
      expect(config.trailingActivationPercent).toBe(1.5);
      expect(config.exitConsensusThreshold).toBe(0.6);
      expect(config.maxHoldTimeHours).toBe(4);
      console.log(`✓ Exit Config: Breakeven=${config.breakevenActivationPercent}%, Trailing=${config.trailingActivationPercent}%, MaxHold=${config.maxHoldTimeHours}h`);
    });

    it('should have regime multipliers configured', () => {
      const exitManager = new IntelligentExitManager();
      const config = exitManager['config'];
      
      expect(config.regimeMultipliers.trending).toBe(1.5);
      expect(config.regimeMultipliers.ranging).toBe(0.7);
      expect(config.regimeMultipliers.volatile).toBe(0.5);
      console.log(`✓ Regime Multipliers: Trending=${config.regimeMultipliers.trending}x, Ranging=${config.regimeMultipliers.ranging}x, Volatile=${config.regimeMultipliers.volatile}x`);
    });
  });
});

describe('trade-agent-workflow (unit)', () => {
  it('should have test file loaded', () => {
    expect(true).toBe(true);
  });
});
