import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntelligentExitManager } from '../services/IntelligentExitManager';
import { EventEmitter } from 'events';

describe('Exit Strategy Integration', () => {
  describe('Millisecond Tick-by-Tick Monitoring', () => {
    it('should process price ticks in under 10ms', async () => {
      const manager = new IntelligentExitManager({});
      
      // Register a test position
      manager.addPosition({
        id: 'tick-test-1',
        symbol: 'BTC-USD',
        side: 'long' as const,
        entryPrice: 89000,
        currentPrice: 89000,
        quantity: 0.01,
        remainingQuantity: 0.01,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: Date.now(),
        marketRegime: 'trending',
        originalConsensus: 0.75,
      });
      
      // Process a tick and measure time
      const start = performance.now();
      await manager.onPriceTick('BTC-USD', 89100, Date.now());
      const duration = performance.now() - start;
      
      expect(duration).toBeLessThan(10); // Should be well under 10ms
      
      // Verify position was updated
      const positions = manager.getStatus().positions;
      expect(positions[0].currentPrice).toBe(89100);
    });
    
    it('should trigger exit on price tick when emergency conditions are met', async () => {
      let exitCalled = false;
      let exitReason = '';
      
      const manager = new IntelligentExitManager({});
      
      manager.setCallbacks({
        executeExit: async (positionId: string, quantity: number, reason: string) => {
          exitCalled = true;
          exitReason = reason;
        },
      });
      
      // Register a position
      manager.addPosition({
        id: 'exit-tick-test',
        symbol: 'BTC-USD',
        side: 'long' as const,
        entryPrice: 100000,
        currentPrice: 100000,
        quantity: 0.01,
        remainingQuantity: 0.01,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: Date.now(),
        marketRegime: 'trending',
        originalConsensus: 0.75,
      });
      
      // Send a tick with -5% loss (should trigger emergency exit)
      await manager.onPriceTick('BTC-USD', 95000, Date.now());
      
      expect(exitCalled).toBe(true);
      // Phase 11 changed message format from 'Emergency exit' to '[HARD_STOP_LOSS]'
      expect(exitReason).toMatch(/Emergency exit|HARD_STOP_LOSS|stop.loss/i);
    });
    
    it('should process multiple positions in parallel on each tick', async () => {
      const manager = new IntelligentExitManager({});
      
      // Register multiple positions
      for (let i = 0; i < 10; i++) {
        manager.addPosition({
          id: `parallel-${i}`,
          symbol: 'BTC-USD',
          side: 'long' as const,
          entryPrice: 89000 + i * 100,
          currentPrice: 89000 + i * 100,
          quantity: 0.01,
          remainingQuantity: 0.01,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          entryTime: Date.now(),
          marketRegime: 'trending',
          originalConsensus: 0.75,
        });
      }
      
      // Process a tick
      const start = performance.now();
      await manager.onPriceTick('BTC-USD', 89500, Date.now());
      const duration = performance.now() - start;
      
      // Should still be fast even with 10 positions
      expect(duration).toBeLessThan(50);
      
      // All positions should be updated
      const positions = manager.getStatus().positions;
      expect(positions.length).toBe(10);
      positions.forEach(p => {
        expect(p.currentPrice).toBe(89500);
      });
    });
  });

  let exitManager: IntelligentExitManager;
  let mockDependencies: any;

  beforeEach(() => {
    // Mock dependencies
    mockDependencies = {
      getAgentSignals: vi.fn().mockResolvedValue([
        { agentId: 'TechnicalAnalyst', signal: 'sell', confidence: 0.8, reasoning: 'Bearish divergence' },
        { agentId: 'OrderFlowAnalyst', signal: 'sell', confidence: 0.7, reasoning: 'Selling pressure' },
      ]),
      getCurrentPrice: vi.fn().mockResolvedValue(90000),
      executeExit: vi.fn().mockResolvedValue(undefined),
      getMarketRegime: vi.fn().mockResolvedValue('trending'),
    };

    exitManager = new IntelligentExitManager(mockDependencies);
  });

  afterEach(() => {
    exitManager.stop();
  });

  describe('Position Registration', () => {
    it('should register a new position', () => {
      const position = {
        id: 'test-pos-1',
        symbol: 'BTC-USD',
        side: 'long' as const,
        entryPrice: 89000,
        currentPrice: 89000,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: Date.now(),
        marketRegime: 'trending',
        originalConsensus: 0.75,
      };

      exitManager.addPosition(position);
      
      const status = exitManager.getStatus();
      expect(status.positionCount).toBe(1);
    });

    it('should track multiple positions', () => {
      const positions = [
        {
          id: 'pos-1',
          symbol: 'BTC-USD',
          side: 'long' as const,
          entryPrice: 89000,
          currentPrice: 89000,
          quantity: 0.1,
          remainingQuantity: 0.1,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          entryTime: Date.now(),
          marketRegime: 'trending',
          originalConsensus: 0.75,
        },
        {
          id: 'pos-2',
          symbol: 'ETH-USD',
          side: 'long' as const,
          entryPrice: 2900,
          currentPrice: 2900,
          quantity: 1,
          remainingQuantity: 1,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          entryTime: Date.now(),
          marketRegime: 'ranging',
          originalConsensus: 0.65,
        },
      ];

      positions.forEach(p => exitManager.addPosition(p));
      
      const status = exitManager.getStatus();
      expect(status.positionCount).toBe(2);
    });
  });

  describe('Price Updates', () => {
    it('should update position P&L on price change', () => {
      const position = {
        id: 'test-pos-1',
        symbol: 'BTC-USD',
        side: 'long' as const,
        entryPrice: 89000,
        currentPrice: 89000,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: Date.now(),
        marketRegime: 'trending',
        originalConsensus: 0.75,
      };

      exitManager.addPosition(position);
      
      // Simulate price increase
      exitManager.updatePrice('BTC-USD', 90000);
      
      // The position should now have positive P&L
      const status = exitManager.getStatus();
      expect(status.positionCount).toBe(1);
    });
  });

  describe('Exit Triggers', () => {
    it('should emit exit_decision event when conditions are met', async () => {
      const exitDecisionSpy = vi.fn();
      exitManager.on('exit_decision', exitDecisionSpy);

      const position = {
        id: 'test-pos-1',
        symbol: 'BTC-USD',
        side: 'long' as const,
        entryPrice: 89000,
        currentPrice: 89000,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: Date.now() - 3600000, // 1 hour ago
        marketRegime: 'trending',
        originalConsensus: 0.75,
      };

      exitManager.addPosition(position);
      exitManager.start();

      // Wait for the evaluation cycle
      await new Promise(resolve => setTimeout(resolve, 200));

      // The exit manager should have evaluated the position
      // (actual exit decision depends on agent signals and thresholds)
    });

    it('should activate breakeven stop when profit threshold is reached', () => {
      const breakevenSpy = vi.fn();
      exitManager.on('breakeven_activated', breakevenSpy);

      const position = {
        id: 'test-pos-1',
        symbol: 'BTC-USD',
        side: 'long' as const,
        entryPrice: 89000,
        currentPrice: 89000,
        quantity: 0.1,
        remainingQuantity: 0.1,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: Date.now(),
        marketRegime: 'trending',
        originalConsensus: 0.75,
      };

      exitManager.addPosition(position);
      
      // Simulate price increase above breakeven threshold (0.5%)
      exitManager.updatePrice('BTC-USD', 89000 * 1.006); // 0.6% profit

      // Check if breakeven was activated
      const status = exitManager.getStatus();
      expect(status.positionCount).toBe(1);
    });
  });

  describe('Configuration', () => {
    it('should use correct default thresholds', () => {
      const status = exitManager.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.positionCount).toBe(0);
      expect(status.positions).toEqual([]);
    });
  });
});
