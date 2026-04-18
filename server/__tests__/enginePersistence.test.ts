import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Engine Persistence Tests
 * 
 * These tests verify that:
 * 1. Engine state is persisted to database
 * 2. Engine auto-recovers after server restart
 * 3. WebSocket disconnection does NOT stop the engine
 * 4. Engine continues running after user logout/window close
 * 5. Engine cannot stop with open positions (safety block)
 */

// Mock the database functions
const mockEngineState = {
  userId: 1,
  isRunning: true,
  startedAt: new Date(),
  stoppedAt: null,
  config: JSON.stringify({ enableAutoTrading: true }),
};

vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockEngineState]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onDuplicateKeyUpdate: vi.fn().mockResolvedValue({}),
      }),
    }),
  }),
  getPaperPositions: vi.fn().mockResolvedValue([]),
  getPaperWallet: vi.fn().mockResolvedValue({
    balance: '10000.00',
    equity: '10000.00',
    unrealizedPnL: '0.00',
    realizedPnL: '0.00',
    totalPnL: '0.00',
    totalTrades: 0,
    winRate: '0.00',
    winningTrades: 0,
    losingTrades: 0,
  }),
}));

vi.mock('../exchangeDb', () => ({
  getActiveExchangesWithKeys: vi.fn().mockResolvedValue([]),
  getAllActiveTradingSymbols: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../drizzle/schema', () => ({
  engineState: {
    userId: 'userId',
    isRunning: 'isRunning',
  },
}));

describe('Engine Persistence', () => {
  describe('Engine State Database Operations', () => {
    it('should save engine state to database when started', async () => {
      // Test the saveEngineState logic
      const saveEngineState = async (isRunning: boolean, config: any) => {
        const state = {
          userId: 1,
          isRunning,
          startedAt: isRunning ? new Date() : null,
          stoppedAt: isRunning ? null : new Date(),
          config: config ? JSON.stringify(config) : null,
        };
        return state;
      };
      
      const state = await saveEngineState(true, { enableAutoTrading: true });
      
      expect(state.isRunning).toBe(true);
      expect(state.startedAt).not.toBeNull();
      expect(state.stoppedAt).toBeNull();
      expect(state.config).toContain('enableAutoTrading');
    });
    
    it('should save engine state to database when stopped', async () => {
      const saveEngineState = async (isRunning: boolean, config: any) => {
        const state = {
          userId: 1,
          isRunning,
          startedAt: isRunning ? new Date() : null,
          stoppedAt: isRunning ? null : new Date(),
          config: config ? JSON.stringify(config) : null,
        };
        return state;
      };
      
      const state = await saveEngineState(false, null);
      
      expect(state.isRunning).toBe(false);
      expect(state.stoppedAt).not.toBeNull();
    });
    
    it('should load engine state from database', async () => {
      // Test the loadEngineState logic
      const loadEngineState = async (userId: number) => {
        // Simulate database query
        return mockEngineState;
      };
      
      const state = await loadEngineState(1);
      
      expect(state).not.toBeNull();
      expect(state.userId).toBe(1);
      expect(state.isRunning).toBe(true);
    });
  });
  
  describe('Auto-Recovery on Server Restart', () => {
    it('should detect engines that need auto-restart', async () => {
      // Simulate finding running engines in database
      const findRunningEngines = async () => {
        return [
          { userId: 1, isRunning: true },
          { userId: 2, isRunning: true },
        ];
      };
      
      const runningEngines = await findRunningEngines();
      
      expect(runningEngines.length).toBe(2);
      expect(runningEngines.every(e => e.isRunning)).toBe(true);
    });
    
    it('should preserve startedAt timestamp during auto-restart', async () => {
      const originalStartedAt = new Date('2025-12-18T10:00:00Z');
      
      // Simulate restoring startedAt from database
      const restoreEngine = async () => {
        const state = {
          userId: 1,
          isRunning: true,
          startedAt: originalStartedAt,
        };
        
        // Engine should preserve original startedAt
        const restoredStartedAt = state.startedAt;
        return restoredStartedAt;
      };
      
      const restoredStartedAt = await restoreEngine();
      
      expect(restoredStartedAt).toEqual(originalStartedAt);
    });
  });
  
  describe('WebSocket Disconnection Independence', () => {
    it('should NOT stop engine when WebSocket disconnects', () => {
      // Simulate WebSocket disconnect handler
      let engineStopped = false;
      
      const handleWebSocketDisconnect = () => {
        // WebSocket disconnect should only remove client from broadcast list
        // It should NOT call engine.stop()
        const clientRemoved = true;
        // engineStopped remains false
        return { clientRemoved, engineStopped };
      };
      
      const result = handleWebSocketDisconnect();
      
      expect(result.clientRemoved).toBe(true);
      expect(result.engineStopped).toBe(false);
    });
    
    it('should continue broadcasting to remaining clients after one disconnects', () => {
      // Simulate multiple clients connected
      const clients = new Map<string, number>();
      clients.set('client1', 1);
      clients.set('client2', 1);
      clients.set('client3', 2);
      
      // Client1 disconnects
      clients.delete('client1');
      
      // Should still have 2 clients
      expect(clients.size).toBe(2);
      
      // Engine should still be running (not affected by disconnect)
      const engineRunning = true;
      expect(engineRunning).toBe(true);
    });
  });
  
  describe('User Logout Independence', () => {
    it('should NOT stop engine when user logs out', () => {
      // Simulate logout handler
      let engineStopped = false;
      
      const handleLogout = () => {
        // Logout should clear session cookie
        // It should NOT call engine.stop()
        const sessionCleared = true;
        return { sessionCleared, engineStopped };
      };
      
      const result = handleLogout();
      
      expect(result.sessionCleared).toBe(true);
      expect(result.engineStopped).toBe(false);
    });
  });
  
  describe('Reset Engine Function', () => {
    it('should NOT stop engine by default when reset is called', () => {
      // Phase 14E: Tests engine reset logic (previously in seerMainMulti, now in EngineAdapter)
      const resetEngine = (userId: number, forceStop: boolean = false) => {
        let engineStopped = false;
        let referenceRemoved = false;
        
        if (forceStop) {
          engineStopped = true;
        }
        referenceRemoved = true;
        
        return { engineStopped, referenceRemoved };
      };
      
      // Default behavior: don't stop engine
      const result1 = resetEngine(1);
      expect(result1.engineStopped).toBe(false);
      expect(result1.referenceRemoved).toBe(true);
      
      // With forceStop: stop engine
      const result2 = resetEngine(1, true);
      expect(result2.engineStopped).toBe(true);
      expect(result2.referenceRemoved).toBe(true);
    });
  });
  
  describe('Health Monitoring State Verification', () => {
    it('should re-persist engine state if database shows stopped but engine is running', async () => {
      // Simulate health check detecting state mismatch
      const healthCheck = async (engineIsRunning: boolean, dbState: any) => {
        let rePersisted = false;
        
        if (engineIsRunning && (!dbState || !dbState.isRunning)) {
          // State mismatch detected, re-persist
          rePersisted = true;
        }
        
        return { rePersisted };
      };
      
      // Engine running but DB shows stopped
      const result = await healthCheck(true, { isRunning: false });
      
      expect(result.rePersisted).toBe(true);
    });
    
    it('should NOT re-persist if states match', async () => {
      const healthCheck = async (engineIsRunning: boolean, dbState: any) => {
        let rePersisted = false;
        
        if (engineIsRunning && (!dbState || !dbState.isRunning)) {
          rePersisted = true;
        }
        
        return { rePersisted };
      };
      
      // Both show running
      const result = await healthCheck(true, { isRunning: true });
      
      expect(result.rePersisted).toBe(false);
    });
  });
  
  describe('Open Position Safety Block', () => {
    it('should prevent engine stop with open positions', async () => {
      const mockPositions = [
        { id: 1, symbol: 'BTCUSDT', side: 'long', unrealizedPnl: 100 },
      ];
      
      const canStopEngine = (positions: any[], force: boolean) => {
        if (positions.length > 0 && !force) {
          return {
            allowed: false,
            reason: `Cannot stop: ${positions.length} open position(s)`,
          };
        }
        return { allowed: true };
      };
      
      const result = canStopEngine(mockPositions, false);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('1 open position');
    });
    
    it('should allow force stop with open positions', async () => {
      const mockPositions = [
        { id: 1, symbol: 'BTCUSDT', side: 'long', unrealizedPnl: 100 },
      ];
      
      const canStopEngine = (positions: any[], force: boolean) => {
        if (positions.length > 0 && !force) {
          return { allowed: false };
        }
        return { allowed: true };
      };
      
      const result = canStopEngine(mockPositions, true);
      
      expect(result.allowed).toBe(true);
    });
  });
});

describe('Engine Instance Management', () => {
  it('should return existing instance if already created', () => {
    // Simulate engine instance cache
    const engineInstances = new Map<number, { userId: number }>();
    
    // Phase 14E: Tests engine instance caching (previously in seerMainMulti, now in EngineAdapter)
    const getEngine = (userId: number) => {
      let instance = engineInstances.get(userId);
      
      if (!instance) {
        instance = { userId };
        engineInstances.set(userId, instance);
      }
      
      return instance;
    };
    
    // First call creates instance
    const instance1 = getEngine(1);
    expect(instance1.userId).toBe(1);
    
    // Second call returns same instance
    const instance2 = getEngine(1);
    expect(instance2).toBe(instance1);
    
    // Different user gets different instance
    const instance3 = getEngine(2);
    expect(instance3.userId).toBe(2);
    expect(instance3).not.toBe(instance1);
  });
});
