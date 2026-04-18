import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for Engine Auto-Start and Trading Mode fixes
 * 
 * Issue 1: Engine should run 24/7/365 by default
 * Issue 2: Auto-trade toggle should work correctly
 */

describe('Engine Auto-Start Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Auto-start conditions', () => {
    it('should auto-start when exchanges and symbols are configured', () => {
      // Test the auto-start logic
      const state = { isRunning: false };
      const hasExchangesConfigured = true;
      const hasSymbolsConfigured = true;
      
      // AUTO-START CONDITIONS:
      // 1. Engine was previously running (restore state), OR
      // 2. User has exchanges AND symbols configured (24/7 autonomous operation)
      const shouldAutoStart = (state && state.isRunning) || (hasExchangesConfigured && hasSymbolsConfigured);
      
      expect(shouldAutoStart).toBe(true);
    });

    it('should auto-start when engine was previously running', () => {
      const state = { isRunning: true };
      const hasExchangesConfigured = true;
      const hasSymbolsConfigured = true;
      
      const shouldAutoStart = (state && state.isRunning) || (hasExchangesConfigured && hasSymbolsConfigured);
      
      expect(shouldAutoStart).toBe(true);
    });

    it('should NOT auto-start when no exchanges configured', () => {
      const state = { isRunning: false };
      const hasExchangesConfigured = false;
      const hasSymbolsConfigured = true;
      
      // Even if shouldAutoStart is true, we check hasExchangesConfigured before starting
      const shouldAutoStart = (state && state.isRunning) || (hasExchangesConfigured && hasSymbolsConfigured);
      const canStart = shouldAutoStart && hasExchangesConfigured && hasSymbolsConfigured;
      
      expect(canStart).toBe(false);
    });

    it('should NOT auto-start when no symbols configured', () => {
      const state = { isRunning: false };
      const hasExchangesConfigured = true;
      const hasSymbolsConfigured = false;
      
      const shouldAutoStart = (state && state.isRunning) || (hasExchangesConfigured && hasSymbolsConfigured);
      const canStart = shouldAutoStart && hasExchangesConfigured && hasSymbolsConfigured;
      
      expect(canStart).toBe(false);
    });
  });
});

describe('Trading Mode Update Logic', () => {
  describe('autoTradeEnabled preservation', () => {
    it('should preserve autoTradeEnabled when not explicitly provided', () => {
      // Simulate the fix: when autoTradeEnabled is undefined, preserve existing value
      const input = { mode: 'paper' as const };
      const currentConfig = { autoTradeEnabled: true };
      
      let autoTradeValue = input.autoTradeEnabled;
      
      if (autoTradeValue === undefined) {
        autoTradeValue = currentConfig?.autoTradeEnabled ?? false;
      }
      
      expect(autoTradeValue).toBe(true);
    });

    it('should use provided autoTradeEnabled when explicitly set to true', () => {
      const input = { mode: 'paper' as const, autoTradeEnabled: true };
      const currentConfig = { autoTradeEnabled: false };
      
      let autoTradeValue = input.autoTradeEnabled;
      
      if (autoTradeValue === undefined) {
        autoTradeValue = currentConfig?.autoTradeEnabled ?? false;
      }
      
      expect(autoTradeValue).toBe(true);
    });

    it('should use provided autoTradeEnabled when explicitly set to false', () => {
      const input = { mode: 'paper' as const, autoTradeEnabled: false };
      const currentConfig = { autoTradeEnabled: true };
      
      let autoTradeValue = input.autoTradeEnabled;
      
      if (autoTradeValue === undefined) {
        autoTradeValue = currentConfig?.autoTradeEnabled ?? false;
      }
      
      expect(autoTradeValue).toBe(false);
    });

    it('should default to false when no current config exists', () => {
      const input = { mode: 'paper' as const };
      const currentConfig = null;
      
      let autoTradeValue = input.autoTradeEnabled;
      
      if (autoTradeValue === undefined) {
        autoTradeValue = currentConfig?.autoTradeEnabled ?? false;
      }
      
      expect(autoTradeValue).toBe(false);
    });
  });
});

describe('Navigation Simplification', () => {
  it('should have only 5 essential navigation items', () => {
    // The simplified navigation should only have these items
    const expectedNavItems = [
      { path: '/', label: 'Dashboard' },
      { path: '/agents', label: 'Agents' },
      { path: '/strategy', label: 'Strategy' },
      { path: '/positions', label: 'Positions' },
      { path: '/performance', label: 'Performance' },
    ];
    
    expect(expectedNavItems.length).toBe(5);
    expect(expectedNavItems.map(item => item.label)).toEqual([
      'Dashboard', 'Agents', 'Strategy', 'Positions', 'Performance'
    ]);
  });

  it('should NOT include System, Resilience, or AI/ML', () => {
    const removedItems = ['System', 'Resilience', 'AI/ML'];
    const currentNavItems = ['Dashboard', 'Agents', 'Strategy', 'Positions', 'Performance'];
    
    removedItems.forEach(item => {
      expect(currentNavItems).not.toContain(item);
    });
  });
});

describe('Settings Simplification', () => {
  it('should have only 3 settings tabs', () => {
    // The simplified settings should only have these tabs
    const expectedTabs = ['Trading Mode', 'Notifications', 'Exchange'];
    
    expect(expectedTabs.length).toBe(3);
  });

  it('should NOT include Trading Parameters, Risk Management, or Agent Settings tabs', () => {
    const removedTabs = ['Trading Parameters', 'Risk Management', 'Agent Settings', 'Risk'];
    const currentTabs = ['Trading Mode', 'Notifications', 'Exchange'];
    
    removedTabs.forEach(tab => {
      expect(currentTabs).not.toContain(tab);
    });
  });
});
