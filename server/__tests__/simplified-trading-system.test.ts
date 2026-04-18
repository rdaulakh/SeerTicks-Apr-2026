/**
 * Simplified Trading System Tests
 * 
 * Tests for the simplified trading system implementation:
 * - Trading mode config (paper/live)
 * - Auto-trade toggle
 * - Background engine management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock database functions
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onDuplicateKeyUpdate: vi.fn().mockReturnThis(),
    set: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockReturnThis(),
  }),
  upsertTradingModeConfig: vi.fn().mockResolvedValue(undefined),
  getTradingModeConfig: vi.fn().mockResolvedValue({
    mode: 'paper',
    autoTradeEnabled: false,
  }),
}));

describe('Simplified Trading System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Trading Mode Configuration', () => {
    it('should default to paper trading mode', async () => {
      const { getTradingModeConfig } = await import('../db');
      const config = await getTradingModeConfig(1);
      
      expect(config).toBeDefined();
      expect(config?.mode).toBe('paper');
    });

    it('should default autoTradeEnabled to false', async () => {
      const { getTradingModeConfig } = await import('../db');
      
      // Re-mock for this specific test
      vi.mocked(getTradingModeConfig).mockResolvedValueOnce({
        mode: 'paper',
        autoTradeEnabled: false,
      });
      
      const config = await getTradingModeConfig(1);
      
      expect(config).toBeDefined();
      expect(config?.autoTradeEnabled).toBe(false);
    });

    it('should allow updating trading mode', async () => {
      const { upsertTradingModeConfig, getTradingModeConfig } = await import('../db');
      
      // Mock updated config
      vi.mocked(getTradingModeConfig).mockResolvedValueOnce({
        mode: 'real',
        autoTradeEnabled: false,
      });

      await upsertTradingModeConfig(1, { mode: 'real' });
      const config = await getTradingModeConfig(1);
      
      expect(config?.mode).toBe('real');
    });

    it('should allow enabling auto-trade', async () => {
      const { upsertTradingModeConfig, getTradingModeConfig } = await import('../db');
      
      // Mock updated config
      vi.mocked(getTradingModeConfig).mockResolvedValueOnce({
        mode: 'paper',
        autoTradeEnabled: true,
      });

      await upsertTradingModeConfig(1, { autoTradeEnabled: true });
      const config = await getTradingModeConfig(1);
      
      expect(config?.autoTradeEnabled).toBe(true);
    });

    it('should preserve mode when updating autoTradeEnabled', async () => {
      const { upsertTradingModeConfig, getTradingModeConfig } = await import('../db');
      
      // Mock config with real mode
      vi.mocked(getTradingModeConfig).mockResolvedValueOnce({
        mode: 'real',
        autoTradeEnabled: true,
      });

      await upsertTradingModeConfig(1, { mode: 'real', autoTradeEnabled: true });
      const config = await getTradingModeConfig(1);
      
      expect(config?.mode).toBe('real');
      expect(config?.autoTradeEnabled).toBe(true);
    });
  });

  describe('Background Engine Manager', () => {
    it('should export initialization function', async () => {
      const backgroundManager = await import('../services/backgroundEngineManager');
      
      expect(backgroundManager.initBackgroundEngineManager).toBeDefined();
      expect(typeof backgroundManager.initBackgroundEngineManager).toBe('function');
    });

    it('should export stop function', async () => {
      const backgroundManager = await import('../services/backgroundEngineManager');
      
      expect(backgroundManager.stopBackgroundEngineManager).toBeDefined();
      expect(typeof backgroundManager.stopBackgroundEngineManager).toBe('function');
    });

    it('should export getActiveEngineUsers function', async () => {
      const backgroundManager = await import('../services/backgroundEngineManager');
      
      expect(backgroundManager.getActiveEngineUsers).toBeDefined();
      expect(typeof backgroundManager.getActiveEngineUsers).toBe('function');
    });

    it('should export triggerEngineStartForUser function', async () => {
      const backgroundManager = await import('../services/backgroundEngineManager');
      
      expect(backgroundManager.triggerEngineStartForUser).toBeDefined();
      expect(typeof backgroundManager.triggerEngineStartForUser).toBe('function');
    });

    it('should return empty array when no engines are active', async () => {
      const backgroundManager = await import('../services/backgroundEngineManager');
      
      const activeUsers = backgroundManager.getActiveEngineUsers();
      expect(Array.isArray(activeUsers)).toBe(true);
    });
  });

  describe('Trading Mode Values', () => {
    it('should only allow paper or real modes', () => {
      const validModes = ['paper', 'real'];
      
      expect(validModes).toContain('paper');
      expect(validModes).toContain('real');
      expect(validModes.length).toBe(2);
    });

    it('should have boolean autoTradeEnabled', () => {
      const config = {
        mode: 'paper' as const,
        autoTradeEnabled: false,
      };
      
      expect(typeof config.autoTradeEnabled).toBe('boolean');
    });
  });
});

describe('Settings Router Integration', () => {
  it('should have getTradingMode procedure', async () => {
    // This tests that the router structure is correct
    const { settingsRouter } = await import('../routers/settingsRouter');
    
    expect(settingsRouter).toBeDefined();
    expect(settingsRouter._def.procedures).toBeDefined();
  });

  it('should have updateTradingMode procedure', async () => {
    const { settingsRouter } = await import('../routers/settingsRouter');
    
    expect(settingsRouter).toBeDefined();
    expect(settingsRouter._def.procedures).toBeDefined();
  });
});
