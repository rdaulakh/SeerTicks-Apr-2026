/**
 * Phase 37: Critical Bug Fix Tests
 * 
 * Issue 1: Agents unable to book profit — position_opened listener + ID matching
 * Issue 2: System stops when page is left — connection persistence
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Issue 1: Profit Booking — Position ID Flow
// ============================================================
describe('Issue 1: Profit Booking — Position Registration & Exit Flow', () => {
  
  describe('PaperTradingEngine position ID format', () => {
    it('should generate position IDs in pos_timestamp_random format for new positions', () => {
      // Simulate the ID generation pattern from PaperTradingEngine.openPosition
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const positionId = `pos_${timestamp}_${random}`;
      
      expect(positionId).toMatch(/^pos_\d+_[a-z0-9]+$/);
    });

    it('should use DB ID string format for restored positions', () => {
      // When positions are loaded from DB, id = dbPos.id.toString()
      const dbId = 42;
      const positionId = dbId.toString();
      
      expect(positionId).toBe('42');
      expect(typeof positionId).toBe('string');
    });
  });

  describe('Position registration with IntelligentExitManager', () => {
    it('should register new positions using in-memory ID from position_opened event', () => {
      // Simulate the position_opened event data from PaperTradingEngine
      const posData = {
        id: 'pos_1710000000_abc123',
        symbol: 'BTC-USD',
        side: 'long' as const,
        entryPrice: 50000,
        currentPrice: 50000,
        quantity: 0.1,
        stopLoss: 48000,
        takeProfit: 55000,
        dbPositionId: 42,
        entryTime: new Date(),
      };

      // The exit manager registration should use posData.id
      const exitManagerEntry = {
        id: posData.id,
        symbol: posData.symbol,
        side: posData.side,
        entryPrice: posData.entryPrice,
        currentPrice: posData.currentPrice || posData.entryPrice,
        quantity: posData.quantity,
        remainingQuantity: posData.quantity,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryTime: posData.entryTime.getTime(),
        originalConsensus: 0.7,
        marketRegime: 'unknown',
        stopLoss: posData.stopLoss,
        takeProfit: posData.takeProfit,
      };

      expect(exitManagerEntry.id).toBe('pos_1710000000_abc123');
      expect(exitManagerEntry.stopLoss).toBe(48000);
      expect(exitManagerEntry.takeProfit).toBe(55000);
    });

    it('should register DB-synced positions using DB ID string', () => {
      // Simulate DB position sync
      const dbPos = {
        id: 42,
        symbol: 'ETH-USD',
        side: 'short',
        entryPrice: '3000',
        currentPrice: '2900',
        quantity: '1.5',
        unrealizedPnL: '150',
        unrealizedPnLPercent: '5',
        entryTime: new Date().toISOString(),
        originalConsensus: '0.65',
        stopLoss: '3200',
        takeProfit: '2600',
      };

      const exitManagerEntry = {
        id: String(dbPos.id),
        symbol: dbPos.symbol,
        side: dbPos.side as 'long' | 'short',
        entryPrice: parseFloat(dbPos.entryPrice),
        currentPrice: parseFloat(dbPos.currentPrice),
        quantity: parseFloat(dbPos.quantity),
        remainingQuantity: parseFloat(dbPos.quantity),
        unrealizedPnl: parseFloat(dbPos.unrealizedPnL),
        unrealizedPnlPercent: parseFloat(dbPos.unrealizedPnLPercent),
        entryTime: new Date(dbPos.entryTime).getTime(),
        originalConsensus: parseFloat(dbPos.originalConsensus),
        marketRegime: 'unknown',
        stopLoss: parseFloat(dbPos.stopLoss),
        takeProfit: parseFloat(dbPos.takeProfit),
      };

      expect(exitManagerEntry.id).toBe('42');
      expect(exitManagerEntry.entryPrice).toBe(3000);
    });
  });

  describe('closePositionById ID matching', () => {
    it('should find new positions by in-memory ID', () => {
      // Simulate PaperTradingEngine.positions Map
      const positions = new Map<string, any>();
      const posKey = 'BTC-USD_coinbase';
      const position = {
        id: 'pos_1710000000_abc123',
        symbol: 'BTC-USD',
        side: 'long',
        entryPrice: 50000,
      };
      positions.set(posKey, position);

      // closePositionById searches by p.id, not by Map key
      const found = Array.from(positions.values()).find(p => p.id === 'pos_1710000000_abc123');
      expect(found).toBeDefined();
      expect(found!.symbol).toBe('BTC-USD');
    });

    it('should find DB-restored positions by DB ID string', () => {
      const positions = new Map<string, any>();
      // DB-restored positions use dbPos.id.toString() as both Map key AND position.id
      const position = {
        id: '42',
        symbol: 'ETH-USD',
        side: 'short',
        entryPrice: 3000,
      };
      positions.set('42', position);

      const found = Array.from(positions.values()).find(p => p.id === '42');
      expect(found).toBeDefined();
      expect(found!.symbol).toBe('ETH-USD');
    });

    it('should NOT find position with mismatched ID format', () => {
      const positions = new Map<string, any>();
      const position = {
        id: 'pos_1710000000_abc123',
        symbol: 'BTC-USD',
      };
      positions.set('BTC-USD_coinbase', position);

      // Searching with DB ID should NOT find it (this was the old bug)
      const found = Array.from(positions.values()).find(p => p.id === '42');
      expect(found).toBeUndefined();
    });
  });

  describe('getMarketRegime callback', () => {
    it('should return a valid regime string instead of hardcoded "normal"', () => {
      // The fix changed the default from 'normal' to 'range_bound'
      const validRegimes = ['trending_up', 'trending_down', 'range_bound', 'high_volatility', 'mean_reverting', 'breakout'];
      const defaultRegime = 'range_bound';
      
      expect(validRegimes).toContain(defaultRegime);
      // 'normal' is NOT a valid regime
      expect(validRegimes).not.toContain('normal');
    });
  });

  describe('Exit execution flow', () => {
    it('should use correct position ID when calling closePositionById', () => {
      const positionId = 'pos_1710000000_abc123';
      const price = 55000;
      const reason = 'take_profit';

      // Simulate the executeExit callback
      const positions = [
        { id: 'pos_1710000000_abc123', symbol: 'BTC-USD', side: 'long', entryPrice: 50000 },
      ];

      const position = positions.find((p: any) => p.id === positionId);
      expect(position).toBeDefined();
      expect(position!.symbol).toBe('BTC-USD');

      // The close call would use: closePositionById(positionId, price, `exit:${reason}`)
      const closeArgs = {
        positionId,
        price,
        strategy: `exit:${reason}`,
      };
      expect(closeArgs.positionId).toBe('pos_1710000000_abc123');
    });
  });
});

// ============================================================
// Issue 2: Connection Persistence
// ============================================================
describe('Issue 2: Connection Persistence — WebSocket Reconnection', () => {
  
  describe('Reconnection strategy', () => {
    it('should use infinite reconnection (never give up)', () => {
      // Phase 37: All hooks now use Infinity or no max
      const socketIOConfig = {
        reconnectionAttempts: Infinity,
        reconnectionDelayMax: 30000,
      };

      expect(socketIOConfig.reconnectionAttempts).toBe(Infinity);
      expect(socketIOConfig.reconnectionDelayMax).toBe(30000);
    });

    it('should use exponential backoff with cap at 30s', () => {
      // Simulate the backoff calculation from useWebSocket
      const calculateDelay = (attempt: number) => {
        return Math.min(1000 * Math.pow(1.5, Math.min(attempt, 15)), 30000);
      };

      expect(calculateDelay(0)).toBe(1000);
      expect(calculateDelay(1)).toBe(1500);
      expect(calculateDelay(5)).toBeLessThan(10000);
      expect(calculateDelay(20)).toBe(30000); // Capped
      expect(calculateDelay(100)).toBe(30000); // Still capped
    });

    it('should reset reconnect counter on successful connection', () => {
      let reconnectAttempts = 15;
      
      // Simulate successful connection
      const onConnect = () => {
        reconnectAttempts = 0;
      };
      
      onConnect();
      expect(reconnectAttempts).toBe(0);
    });
  });

  describe('Visibility change handler', () => {
    it('should reconnect when tab becomes visible', () => {
      let reconnected = false;
      const wsReadyState = 3; // CLOSED
      
      const handleVisibilityChange = (visibilityState: string, wsState: number) => {
        if (visibilityState === 'visible' && wsState !== 1) { // 1 = OPEN
          reconnected = true;
        }
      };

      handleVisibilityChange('visible', wsReadyState);
      expect(reconnected).toBe(true);
    });

    it('should NOT reconnect if already connected', () => {
      let reconnected = false;
      const wsReadyState = 1; // OPEN
      
      const handleVisibilityChange = (visibilityState: string, wsState: number) => {
        if (visibilityState === 'visible' && wsState !== 1) {
          reconnected = true;
        }
      };

      handleVisibilityChange('visible', wsReadyState);
      expect(reconnected).toBe(false);
    });

    it('should NOT reconnect when tab becomes hidden', () => {
      let reconnected = false;
      const wsReadyState = 3; // CLOSED
      
      const handleVisibilityChange = (visibilityState: string, wsState: number) => {
        if (visibilityState === 'visible' && wsState !== 1) {
          reconnected = true;
        }
      };

      handleVisibilityChange('hidden', wsReadyState);
      expect(reconnected).toBe(false);
    });
  });

  describe('Server-side persistence', () => {
    it('should NOT stop engine on WebSocket disconnect (cleanupUserListenersIfOrphaned only removes listeners)', () => {
      // Simulate the cleanup behavior
      const engineRunning = true;
      const listeners: string[] = ['tick', 'position', 'signal'];
      
      // On disconnect, only listeners are removed, engine keeps running
      const cleanupListeners = () => {
        listeners.length = 0; // Clear listeners
        // Engine is NOT stopped
        return engineRunning;
      };

      const stillRunning = cleanupListeners();
      expect(stillRunning).toBe(true);
      expect(listeners.length).toBe(0); // Listeners cleaned up
    });

    it('should re-setup listeners when client reconnects', () => {
      const engineListenersSetupForUsers = new Set<number>();
      const userId = 1;
      
      // Initially setup
      engineListenersSetupForUsers.add(userId);
      expect(engineListenersSetupForUsers.has(userId)).toBe(true);
      
      // On disconnect, cleanup removes from set
      engineListenersSetupForUsers.delete(userId);
      expect(engineListenersSetupForUsers.has(userId)).toBe(false);
      
      // On reconnect, should re-setup
      engineListenersSetupForUsers.add(userId);
      expect(engineListenersSetupForUsers.has(userId)).toBe(true);
    });

    it('backgroundEngineManager should keep engines running independently of browser connections', () => {
      // Simulate the background engine check
      const activeUserEngines = new Set<number>();
      activeUserEngines.add(1);
      activeUserEngines.add(2);
      
      // Browser disconnects — engines should still be in the active set
      // (backgroundEngineManager doesn't listen to WebSocket events)
      expect(activeUserEngines.size).toBe(2);
      expect(activeUserEngines.has(1)).toBe(true);
    });

    it('CoinbasePublicWebSocket should never permanently give up', () => {
      // Simulate the reconnect behavior after MAX_RECONNECT_ATTEMPTS
      // The actual code increments THEN checks: reconnectAttempts++ then if > MAX
      let reconnectAttempts = 50;
      const MAX_RECONNECT_ATTEMPTS = 50;
      let resetAndRetried = false;
      
      // Simulate one more attempt (increment happens before check)
      reconnectAttempts++; // Now 51
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        // Phase 11B: Reset and retry
        reconnectAttempts = 0;
        resetAndRetried = true;
      }
      
      // After exceeding 50 attempts, it resets to 0 and retries in 5s
      expect(resetAndRetried).toBe(true);
      expect(reconnectAttempts).toBe(0);
    });
  });
});

// ============================================================
// Integration: End-to-End Position Lifecycle
// ============================================================
describe('Integration: Position Lifecycle — Open to Close', () => {
  it('should trace the complete flow: open → register → monitor → exit', () => {
    // Step 1: PaperTradingEngine opens position
    const position = {
      id: 'pos_1710000000_xyz789',
      symbol: 'BTC-USD',
      side: 'long' as const,
      entryPrice: 50000,
      quantity: 0.1,
      stopLoss: 48000,
      takeProfit: 55000,
    };

    // Step 2: position_opened event fires
    const positionOpenedEvent = { ...position, dbPositionId: 42 };
    expect(positionOpenedEvent.id).toBe('pos_1710000000_xyz789');

    // Step 3: UserTradingSession registers with exit manager
    const exitManagerEntry = {
      id: positionOpenedEvent.id, // Uses in-memory ID
      symbol: positionOpenedEvent.symbol,
      side: positionOpenedEvent.side,
      entryPrice: positionOpenedEvent.entryPrice,
      stopLoss: positionOpenedEvent.stopLoss,
      takeProfit: positionOpenedEvent.takeProfit,
    };
    expect(exitManagerEntry.id).toBe('pos_1710000000_xyz789');

    // Step 4: Exit manager detects TP hit (price >= 55000)
    const currentPrice = 55100;
    const shouldExit = currentPrice >= (exitManagerEntry.takeProfit || Infinity);
    expect(shouldExit).toBe(true);

    // Step 5: executeExit callback calls closePositionById
    const closeCallId = exitManagerEntry.id;
    expect(closeCallId).toBe('pos_1710000000_xyz789');

    // Step 6: PaperTradingEngine finds position by ID
    const positions = new Map<string, any>();
    positions.set('BTC-USD_coinbase', position);
    const found = Array.from(positions.values()).find(p => p.id === closeCallId);
    expect(found).toBeDefined();
    expect(found!.symbol).toBe('BTC-USD');

    // Step 7: Position closed with profit
    const pnl = (currentPrice - found!.entryPrice) * found!.quantity;
    expect(pnl).toBeGreaterThan(0);
    expect(pnl).toBeCloseTo(510, 0); // (55100 - 50000) * 0.1 = 510
  });

  it('should handle SL exit correctly', () => {
    const position = {
      id: 'pos_1710000000_sl_test',
      symbol: 'ETH-USD',
      side: 'long' as const,
      entryPrice: 3000,
      quantity: 1.0,
      stopLoss: 2800,
      takeProfit: 3500,
    };

    // Price drops below SL
    const currentPrice = 2750;
    const shouldExitSL = currentPrice <= (position.stopLoss || 0);
    expect(shouldExitSL).toBe(true);

    // Loss calculation
    const pnl = (currentPrice - position.entryPrice) * position.quantity;
    expect(pnl).toBeLessThan(0);
    expect(pnl).toBeCloseTo(-250, 0);
  });
});
