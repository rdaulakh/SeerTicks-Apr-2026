import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { IntelligentExitManager, Position, AgentExitSignal } from '../services/IntelligentExitManager';
import { AutomatedTradeExecutor } from '../services/AutomatedTradeExecutor';
import { AutomatedSignalProcessor } from '../services/AutomatedSignalProcessor';
import type { AgentSignal } from '../agents/AgentBase';
import { getTradingConfig, setTradingConfig } from '../config/TradingConfig';

// AutomatedSignalProcessor now enforces candle-availability and price-feed
// staleness gates before consensus. This suite has no real data feeds, so
// disable both gates for the duration of the test run and restore after.
const __originalTradingConfig = getTradingConfig();
beforeAll(() => {
  setTradingConfig({
    ...__originalTradingConfig,
    entry: {
      ...__originalTradingConfig.entry,
      minHistoricalCandlesRequired: 0,
      priceFeedMaxStalenessMs: Number.MAX_SAFE_INTEGER,
    },
  });
});
afterAll(() => {
  setTradingConfig(__originalTradingConfig);
});

describe('IntelligentExitManager Integration', () => {
  describe('IntelligentExitManager Initialization', () => {
    it('should initialize with default configuration', () => {
      const exitManager = new IntelligentExitManager();
      
      expect(exitManager).toBeDefined();
      expect(exitManager.getPositions()).toEqual([]);
    });

    it('should initialize with custom configuration', () => {
      const exitManager = new IntelligentExitManager({
        breakevenActivationPercent: 1.0,
        breakevenBuffer: 0.2,
        trailingActivationPercent: 2.0,
        trailingPercent: 1.0,
        useATRTrailing: true,
        atrTrailingMultiplier: 2.5,
        exitConsensusThreshold: 0.7,
        maxHoldTimeHours: 8,
        minProfitForTimeExit: 0.5,
      });
      
      expect(exitManager).toBeDefined();
    });
  });

  describe('Position Management', () => {
    let exitManager: IntelligentExitManager;

    beforeEach(() => {
      exitManager = new IntelligentExitManager({
        breakevenActivationPercent: 0.5,
        breakevenBuffer: 0.1,
        trailingActivationPercent: 1.5,
        trailingPercent: 0.5,
        exitConsensusThreshold: 0.6,
        maxHoldTimeHours: 4,
        agentCheckIntervalMs: 5000,
        priceCheckIntervalMs: 100,
      });
    });

    it('should add a position for monitoring', () => {
      const positionId = 'test_position_1';
      
      exitManager.addPosition({
        id: positionId,
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 50000,
        currentPrice: 50000,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: Date.now(),
        marketRegime: 'trending',
        originalConsensus: 0.85,
      });

      const positions = exitManager.getPositions();
      expect(positions.length).toBe(1);
      expect(positions[0].id).toBe(positionId);
      expect(positions[0].symbol).toBe('BTC-USD');
      expect(positions[0].side).toBe('long');
    });

    it('should remove a position from monitoring', () => {
      const positionId = 'test_position_2';
      
      exitManager.addPosition({
        id: positionId,
        symbol: 'ETH-USD',
        side: 'short',
        entryPrice: 3000,
        currentPrice: 3000,
        quantity: 1,
        remainingQuantity: 1,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: Date.now(),
        marketRegime: 'ranging',
        originalConsensus: 0.75,
      });

      expect(exitManager.getPositions().length).toBe(1);
      
      exitManager.removePosition(positionId);
      
      expect(exitManager.getPositions().length).toBe(0);
    });

    it('should update position price and calculate PnL', () => {
      const positionId = 'test_position_3';
      
      exitManager.addPosition({
        id: positionId,
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 50000,
        currentPrice: 50000,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: Date.now(),
        marketRegime: 'trending',
        originalConsensus: 0.85,
      });

      // Update price to simulate profit
      exitManager.updatePrice(positionId, 51000);
      
      const positions = exitManager.getPositions();
      expect(positions[0].currentPrice).toBe(51000);
      expect(positions[0].unrealizedPnlPercent).toBeCloseTo(2, 1); // ~2% profit
    });
  });

  describe('Exit Decision Logic', () => {
    let exitManager: IntelligentExitManager;

    beforeEach(() => {
      exitManager = new IntelligentExitManager({
        breakevenActivationPercent: 0.5,
        breakevenBuffer: 0.1,
        trailingActivationPercent: 1.5,
        trailingPercent: 0.5,
        partialProfitLevels: [
          { pnlPercent: 1.0, exitPercent: 25 },
          { pnlPercent: 1.5, exitPercent: 25 },
          { pnlPercent: 2.0, exitPercent: 25 },
        ],
        exitConsensusThreshold: 0.6,
        maxHoldTimeHours: 4,
      });
    });

    it('should calculate exit decision for profitable position', async () => {
      const position: Position = {
        id: 'test_pos',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 50000,
        currentPrice: 51000, // 2% profit
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnl: 100,
        unrealizedPnlPercent: 2,
        entryTime: Date.now() - 3600000, // 1 hour ago
        highestPrice: 51000,
        lowestPrice: 50000,
        breakevenActivated: false,
        partialExits: [],
        agentSignals: [],
        marketRegime: 'trending',
        originalConsensus: 0.85,
        lastAgentCheck: 0,
      };

      const decision = exitManager.evaluatePosition(position);
      
      expect(decision).toBeDefined();
      expect(['hold', 'exit_full', 'exit_partial', 'move_breakeven', 'trail_stop']).toContain(decision.action);
    });

    it('should activate breakeven when profit threshold reached', async () => {
      const position: Position = {
        id: 'test_pos_be',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 50000,
        currentPrice: 50300, // 0.6% profit (above 0.5% threshold)
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnl: 30,
        unrealizedPnlPercent: 0.6,
        entryTime: Date.now() - 3600000,
        highestPrice: 50300,
        lowestPrice: 50000,
        breakevenActivated: false,
        partialExits: [],
        agentSignals: [],
        marketRegime: 'trending',
        originalConsensus: 0.85,
        lastAgentCheck: 0,
      };

      const decision = exitManager.evaluatePosition(position);
      
      // Should either activate breakeven or hold
      expect(['hold', 'move_breakeven']).toContain(decision.action);
    });
  });

  describe('AutomatedTradeExecutor with IntelligentExitManager', () => {
    it('should accept IntelligentExitManager as dependency', () => {
      const exitManager = new IntelligentExitManager();
      const executor = new AutomatedTradeExecutor(1, {
        maxPositionSize: 0.20,
        defaultStopLoss: 0.05,
        defaultTakeProfit: 0.10,
      });

      // Mock dependencies
      const mockPaperTradingEngine = {
        placeOrder: vi.fn(),
        getPositions: vi.fn().mockReturnValue([]),
      };
      const mockPositionManager = {
        getOpenPositions: vi.fn().mockResolvedValue([]),
      };
      const mockRiskManager = {};

      // Set dependencies including IntelligentExitManager
      executor.setDependencies(
        mockPaperTradingEngine as any,
        mockPositionManager as any,
        mockRiskManager as any,
        undefined,
        exitManager
      );

      expect(executor).toBeDefined();
    });
  });

  describe('Signal Processing to Exit Management Flow', () => {
    it('should process signals and prepare for exit management', async () => {
      const processor = new AutomatedSignalProcessor(1, {
        minConfidence: 0.60,
        minExecutionScore: 50,
        consensusThreshold: 0.65,
      });

      // Phase 15B requires min 4 agents agreeing AND >55% directional dominance
      const signals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.85,
          executionScore: 90,
          qualityScore: 0.9,
          reasoning: 'Strong uptrend',
          timestamp: Date.now(),
        },
        {
          agentName: 'PatternMatcher',
          signal: 'bullish',
          confidence: 0.80,
          executionScore: 85,
          qualityScore: 0.85,
          reasoning: 'Bullish pattern',
          timestamp: Date.now(),
        },
        {
          agentName: 'OrderFlowAnalyst',
          signal: 'bullish',
          confidence: 0.78,
          executionScore: 82,
          qualityScore: 0.82,
          reasoning: 'Strong buy pressure',
          timestamp: Date.now(),
        },
        {
          agentName: 'OnChainAnalyst',
          signal: 'bullish',
          confidence: 0.74,
          executionScore: 76,
          qualityScore: 0.78,
          reasoning: 'Whale accumulation',
          timestamp: Date.now(),
        },
        {
          agentName: 'SentimentAnalyst',
          signal: 'bullish',
          confidence: 0.72,
          executionScore: 74,
          qualityScore: 0.76,
          reasoning: 'Positive market sentiment',
          timestamp: Date.now(),
        },
      ];

      const result = await processor.processSignals(signals, 'BTC-USD');

      expect(result.approved).toBe(true);
      expect(result.recommendation).toBeDefined();
      expect(result.recommendation?.action).toBe('buy');
      expect(result.recommendation?.confidence).toBeGreaterThan(0.6);
    });
  });

  describe('Event Emission', () => {
    it('should emit position_added event when position is added', async () => {
      const exitManager = new IntelligentExitManager();
      
      const eventPromise = new Promise<void>((resolve) => {
        exitManager.on('position_added', (position) => {
          expect(position.id).toBe('event_test_pos');
          expect(position.symbol).toBe('BTC-USD');
          resolve();
        });
      });

      exitManager.addPosition({
        id: 'event_test_pos',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 50000,
        currentPrice: 50000,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: Date.now(),
        marketRegime: 'trending',
        originalConsensus: 0.85,
      });
      
      await eventPromise;
    });

    it('should emit position_removed event when position is removed', async () => {
      const exitManager = new IntelligentExitManager();
      
      exitManager.addPosition({
        id: 'remove_test_pos',
        symbol: 'ETH-USD',
        side: 'short',
        entryPrice: 3000,
        currentPrice: 3000,
        quantity: 1,
        remainingQuantity: 1,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: Date.now(),
        marketRegime: 'ranging',
        originalConsensus: 0.75,
      });

      const eventPromise = new Promise<void>((resolve) => {
        exitManager.on('position_removed', (data) => {
          expect(data.positionId).toBe('remove_test_pos');
          resolve();
        });
      });

      exitManager.removePosition('remove_test_pos');
      
      await eventPromise;
    });
  });

  describe('Start/Stop Lifecycle', () => {
    it('should start and stop monitoring without errors', () => {
      const exitManager = new IntelligentExitManager({
        agentCheckIntervalMs: 10000,
        priceCheckIntervalMs: 1000,
      });

      // Set callbacks before starting
      exitManager.setCallbacks({
        getAgentSignals: async () => [],
        getCurrentPrice: async () => 50000,
        executeExit: async () => {},
        getMarketRegime: async () => 'trending',
      });

      exitManager.start();
      expect(exitManager.isMonitoringActive()).toBe(true);

      exitManager.stop();
      expect(exitManager.isMonitoringActive()).toBe(false);
    });
  });
});
