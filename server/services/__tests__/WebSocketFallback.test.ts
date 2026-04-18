/**
 * Unit Tests for WebSocket Fallback System
 * Tests MultiProviderPriceFeed and WebSocketFallbackManager
 * Note: Kraken provider was removed — user doesn't have Kraken account
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock WebSocket
vi.mock('ws', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      readyState: 1, // OPEN
    })),
  };
});

// Mock priceFeedService
vi.mock('../priceFeedService', () => ({
  priceFeedService: {
    updatePrice: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getLatestPrice: vi.fn(),
  },
}));

describe('MultiProviderPriceFeed', () => {
  let MultiProviderPriceFeed: any;
  let priceFeed: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import('../MultiProviderPriceFeed');
    MultiProviderPriceFeed = module.MultiProviderPriceFeed;
    priceFeed = new MultiProviderPriceFeed();
  });

  afterEach(() => {
    if (priceFeed) {
      priceFeed.stop();
    }
  });

  describe('Provider Configuration', () => {
    it('should have CoinCap provider configured', () => {
      const status = priceFeed.getStatus();
      const coincapProvider = status.providers.find((p: any) => p.name === 'CoinCap');
      expect(coincapProvider).toBeDefined();
    });

    it('should NOT have Kraken provider (removed)', () => {
      const status = priceFeed.getStatus();
      const krakenProvider = status.providers.find((p: any) => p.name === 'Kraken');
      expect(krakenProvider).toBeUndefined();
    });

    it('should have all providers initially disconnected', () => {
      const status = priceFeed.getStatus();
      status.providers.forEach((provider: any) => {
        expect(provider.connected).toBe(false);
      });
    });

    it('should have no active provider initially', () => {
      const status = priceFeed.getStatus();
      expect(status.activeProvider).toBeNull();
    });
  });

  describe('Symbol Mapping', () => {
    it('should map BTC-USD to bitcoin for CoinCap', () => {
      const providers = (priceFeed as any).providers;
      const coincapConfig = providers.get('coincap');
      expect(coincapConfig.symbolMapping.get('BTC-USD')).toBe('bitcoin');
    });

    it('should map ETH-USD to ethereum for CoinCap', () => {
      const providers = (priceFeed as any).providers;
      const coincapConfig = providers.get('coincap');
      expect(coincapConfig.symbolMapping.get('ETH-USD')).toBe('ethereum');
    });

    it('should have reverse mapping for CoinCap', () => {
      const providers = (priceFeed as any).providers;
      const coincapConfig = providers.get('coincap');
      expect(coincapConfig.reverseSymbolMapping.get('bitcoin')).toBe('BTC-USD');
    });
  });

  describe('Status Reporting', () => {
    it('should return correct status structure', () => {
      const status = priceFeed.getStatus();
      expect(status).toHaveProperty('providers');
      expect(status).toHaveProperty('activeProvider');
      expect(Array.isArray(status.providers)).toBe(true);
    });

    it('should report isConnected as false when no provider is active', () => {
      expect(priceFeed.isConnected()).toBe(false);
    });

    it('should return null for getActiveProvider when not connected', () => {
      expect(priceFeed.getActiveProvider()).toBeNull();
    });
  });

  describe('Symbol Management', () => {
    it('should add symbols correctly', () => {
      priceFeed.addSymbol('SOL-USD');
      const symbols = (priceFeed as any).symbols;
      expect(symbols).toContain('SOL-USD');
    });

    it('should not add duplicate symbols', () => {
      priceFeed.addSymbol('BTC-USD');
      priceFeed.addSymbol('BTC-USD');
      const symbols = (priceFeed as any).symbols;
      const btcCount = symbols.filter((s: string) => s === 'BTC-USD').length;
      expect(btcCount).toBe(1);
    });

    it('should remove symbols correctly', () => {
      priceFeed.addSymbol('DOGE-USD');
      priceFeed.removeSymbol('DOGE-USD');
      const symbols = (priceFeed as any).symbols;
      expect(symbols).not.toContain('DOGE-USD');
    });
  });

  describe('CoinCap Message Handling', () => {
    it('should parse CoinCap price message correctly', async () => {
      const { priceFeedService } = await vi.importMock<typeof import('../priceFeedService')>('../priceFeedService');

      const message = { bitcoin: '95696.45', ethereum: '3313.22' };
      (priceFeed as any).handleCoinCapMessage(message);

      expect(priceFeedService.updatePrice).toHaveBeenCalledWith(
        'BTC-USD',
        95696.45,
        'websocket',
        expect.any(Object)
      );
      expect(priceFeedService.updatePrice).toHaveBeenCalledWith(
        'ETH-USD',
        3313.22,
        'websocket',
        expect.any(Object)
      );
    });

    it('should emit price event for CoinCap messages', () => {
      const priceHandler = vi.fn();
      priceFeed.on('price', priceHandler);

      const message = { bitcoin: '95000.00' };
      (priceFeed as any).handleCoinCapMessage(message);

      expect(priceHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTC-USD',
          price: 95000,
          provider: 'CoinCap',
        })
      );
    });

    it('should ignore unknown CoinCap symbols', async () => {
      const { priceFeedService } = await vi.importMock<typeof import('../priceFeedService')>('../priceFeedService');
      vi.clearAllMocks();

      const message = { unknowncoin: '100.00' };
      (priceFeed as any).handleCoinCapMessage(message);

      expect(priceFeedService.updatePrice).not.toHaveBeenCalled();
    });
  });

  describe('Reconnection Logic', () => {
    it('should track reconnect attempts per provider', () => {
      const status = priceFeed.getStatus();
      status.providers.forEach((provider: any) => {
        expect(provider.reconnectAttempts).toBe(0);
      });
    });

    it('should have max reconnect attempts configured', () => {
      const maxAttempts = (priceFeed as any).maxReconnectAttempts;
      expect(maxAttempts).toBeGreaterThan(0);
    });

    it('should have exponential backoff configured', () => {
      const baseDelay = (priceFeed as any).baseReconnectDelay;
      const maxDelay = (priceFeed as any).maxReconnectDelay;
      expect(baseDelay).toBe(1000);
      expect(maxDelay).toBe(30000);
    });
  });

  describe('Stop/Cleanup', () => {
    it('should stop cleanly', () => {
      priceFeed.stop();
      expect(priceFeed.isConnected()).toBe(false);
      expect(priceFeed.getActiveProvider()).toBeNull();
    });

    it('should set isShuttingDown flag when stopping', () => {
      priceFeed.stop();
      expect((priceFeed as any).isShuttingDown).toBe(true);
    });
  });
});

describe('WebSocketFallbackManager', () => {
  let WebSocketFallbackManager: any;
  let fallbackManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import('../WebSocketFallbackManager');
    WebSocketFallbackManager = module.WebSocketFallbackManager;
    fallbackManager = new WebSocketFallbackManager();
  });

  afterEach(() => {
    if (fallbackManager) {
      fallbackManager.stop();
    }
  });

  describe('Initial State', () => {
    it('should start with primary disconnected', () => {
      const status = fallbackManager.getStatus();
      expect(status.primaryConnected).toBe(false);
    });

    it('should start with fallback inactive', () => {
      const status = fallbackManager.getStatus();
      expect(status.fallbackActive).toBe(false);
    });

    it('should report Coinbase as primary provider', () => {
      const status = fallbackManager.getStatus();
      expect(status.primaryProvider).toBe('Coinbase');
    });

    it('should start with no symbols', () => {
      const status = fallbackManager.getStatus();
      expect(status.symbols).toEqual([]);
    });

    it('should start with zero price updates', () => {
      const status = fallbackManager.getStatus();
      expect(status.totalPriceUpdates).toBe(0);
    });
  });

  describe('Primary WebSocket Reporting', () => {
    it('should update lastPrimaryMessage on reportPrimaryMessage', () => {
      const before = Date.now();
      fallbackManager.reportPrimaryMessage();
      const after = Date.now();

      const status = fallbackManager.getStatus();
      expect(status.lastPrimaryMessage).toBeGreaterThanOrEqual(before);
      expect(status.lastPrimaryMessage).toBeLessThanOrEqual(after);
    });

    it('should set primaryConnected to true on reportPrimaryMessage', () => {
      fallbackManager.reportPrimaryMessage();
      const status = fallbackManager.getStatus();
      expect(status.primaryConnected).toBe(true);
    });

    it('should set primaryConnected to false on reportPrimaryDisconnected', () => {
      fallbackManager.reportPrimaryMessage();
      fallbackManager.reportPrimaryDisconnected();
      const status = fallbackManager.getStatus();
      expect(status.primaryConnected).toBe(false);
    });

    it('should activate fallback on reportPrimaryDisconnected', () => {
      fallbackManager.reportPrimaryDisconnected();
      const status = fallbackManager.getStatus();
      expect(status.fallbackActive).toBe(true);
    });

    it('should deactivate fallback on reportPrimaryConnected', () => {
      fallbackManager.reportPrimaryDisconnected();
      fallbackManager.reportPrimaryConnected();
      const status = fallbackManager.getStatus();
      expect(status.fallbackActive).toBe(false);
    });
  });

  describe('Manual Fallback Control', () => {
    it('should activate fallback on forceActivateFallback', () => {
      fallbackManager.forceActivateFallback();
      const status = fallbackManager.getStatus();
      expect(status.fallbackActive).toBe(true);
    });

    it('should deactivate fallback on forceDeactivateFallback', () => {
      fallbackManager.forceActivateFallback();
      fallbackManager.forceDeactivateFallback();
      const status = fallbackManager.getStatus();
      expect(status.fallbackActive).toBe(false);
    });
  });

  describe('Connection Status', () => {
    it('should return false for isConnected when nothing is connected', () => {
      expect(fallbackManager.isConnected()).toBe(false);
    });

    it('should return true for isConnected when primary is connected', () => {
      fallbackManager.reportPrimaryConnected();
      expect(fallbackManager.isConnected()).toBe(true);
    });

    it('should return true for isConnected when fallback is active', () => {
      fallbackManager.forceActivateFallback();
      expect(fallbackManager.isConnected()).toBe(true);
    });
  });

  describe('Symbol Management', () => {
    it('should add symbols correctly', () => {
      fallbackManager.addSymbol('BTC-USD');
      const status = fallbackManager.getStatus();
      expect(status.symbols).toContain('BTC-USD');
    });

    it('should not add duplicate symbols', () => {
      fallbackManager.addSymbol('ETH-USD');
      fallbackManager.addSymbol('ETH-USD');
      const status = fallbackManager.getStatus();
      const ethCount = status.symbols.filter((s: string) => s === 'ETH-USD').length;
      expect(ethCount).toBe(1);
    });

    it('should remove symbols correctly', () => {
      fallbackManager.addSymbol('SOL-USD');
      fallbackManager.removeSymbol('SOL-USD');
      const status = fallbackManager.getStatus();
      expect(status.symbols).not.toContain('SOL-USD');
    });
  });

  describe('Event Emission', () => {
    it('should emit fallback_activated event', () => {
      const handler = vi.fn();
      fallbackManager.on('fallback_activated', handler);
      fallbackManager.forceActivateFallback();
      expect(handler).toHaveBeenCalled();
    });

    it('should emit fallback_deactivated event', () => {
      const handler = vi.fn();
      fallbackManager.on('fallback_deactivated', handler);
      fallbackManager.forceActivateFallback();
      fallbackManager.forceDeactivateFallback();
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Status Structure', () => {
    it('should return correct status structure', () => {
      const status = fallbackManager.getStatus();
      expect(status).toHaveProperty('primaryConnected');
      expect(status).toHaveProperty('primaryProvider');
      expect(status).toHaveProperty('fallbackActive');
      expect(status).toHaveProperty('fallbackProvider');
      expect(status).toHaveProperty('lastPrimaryMessage');
      expect(status).toHaveProperty('lastFallbackMessage');
      expect(status).toHaveProperty('symbols');
      expect(status).toHaveProperty('totalPriceUpdates');
    });
  });

  describe('Stop/Cleanup', () => {
    it('should stop cleanly', () => {
      fallbackManager.stop();
      expect(fallbackManager.isConnected()).toBe(false);
    });

    it('should set isRunning to false when stopped', () => {
      fallbackManager.stop();
      expect((fallbackManager as any).isRunning).toBe(false);
    });

    it('should deactivate fallback when stopped', () => {
      fallbackManager.forceActivateFallback();
      fallbackManager.stop();
      const status = fallbackManager.getStatus();
      expect(status.fallbackActive).toBe(false);
    });
  });
});

describe('Integration Tests', () => {
  describe('Price Normalization', () => {
    it('should normalize BTC symbol for CoinCap', async () => {
      const { MultiProviderPriceFeed } = await import('../MultiProviderPriceFeed');
      const priceFeed = new MultiProviderPriceFeed();

      const providers = (priceFeed as any).providers;
      const coincapConfig = providers.get('coincap');

      expect(coincapConfig.reverseSymbolMapping.get('bitcoin')).toBe('BTC-USD');

      priceFeed.stop();
    });

    it('should normalize ETH symbol for CoinCap', async () => {
      const { MultiProviderPriceFeed } = await import('../MultiProviderPriceFeed');
      const priceFeed = new MultiProviderPriceFeed();

      const providers = (priceFeed as any).providers;
      const coincapConfig = providers.get('coincap');

      expect(coincapConfig.reverseSymbolMapping.get('ethereum')).toBe('ETH-USD');

      priceFeed.stop();
    });
  });

  describe('Fallback Activation Scenarios', () => {
    it('should activate fallback when primary reports disconnected', async () => {
      const { WebSocketFallbackManager } = await import('../WebSocketFallbackManager');
      const manager = new WebSocketFallbackManager();

      manager.reportPrimaryDisconnected();
      expect(manager.getStatus().fallbackActive).toBe(true);

      manager.stop();
    });

    it('should deactivate fallback when primary reconnects', async () => {
      const { WebSocketFallbackManager } = await import('../WebSocketFallbackManager');
      const manager = new WebSocketFallbackManager();

      manager.reportPrimaryDisconnected();
      manager.reportPrimaryConnected();
      expect(manager.getStatus().fallbackActive).toBe(false);

      manager.stop();
    });
  });
});
