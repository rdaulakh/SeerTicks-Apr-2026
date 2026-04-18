/**
 * Live Price Streaming Tests
 * 
 * Tests for real-time price updates flowing from exchange WebSocket
 * through priceFeedService to Socket.IO clients.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { priceFeedService } from '../services/priceFeedService';

describe('Live Price Streaming', () => {
  beforeEach(() => {
    // Clear the price cache before each test
    priceFeedService.clearCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('PriceFeedService', () => {
    it('should update price and emit event', () => {
      const priceUpdateHandler = vi.fn();
      priceFeedService.on('price_update', priceUpdateHandler);

      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket', {
        volume24h: 1000000,
      });

      expect(priceUpdateHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTC-USD',
          price: 50000,
          source: 'websocket',
          volume24h: 1000000,
        })
      );

      priceFeedService.off('price_update', priceUpdateHandler);
    });

    it('should retrieve latest price', () => {
      priceFeedService.updatePrice('ETH-USD', 3000, 'websocket');

      const price = priceFeedService.getLatestPrice('ETH-USD');

      expect(price).toBeDefined();
      expect(price?.price).toBe(3000);
      expect(price?.symbol).toBe('ETH-USD');
    });

    it('should return undefined for non-existent symbol', () => {
      const price = priceFeedService.getLatestPrice('NONEXISTENT-USD');
      expect(price).toBeUndefined();
    });

    it('should get all prices', () => {
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      priceFeedService.updatePrice('ETH-USD', 3000, 'websocket');
      priceFeedService.updatePrice('SOL-USD', 100, 'websocket');

      const allPrices = priceFeedService.getAllPrices();

      expect(allPrices.length).toBe(3);
      expect(allPrices.map(p => p.symbol).sort()).toEqual(['BTC-USD', 'ETH-USD', 'SOL-USD']);
    });

    it('should get prices for specific symbols', () => {
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      priceFeedService.updatePrice('ETH-USD', 3000, 'websocket');
      priceFeedService.updatePrice('SOL-USD', 100, 'websocket');

      const prices = priceFeedService.getPrices(['BTC-USD', 'ETH-USD']);

      expect(prices.size).toBe(2);
      expect(prices.get('BTC-USD')?.price).toBe(50000);
      expect(prices.get('ETH-USD')?.price).toBe(3000);
    });

    it('should check price availability', () => {
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');

      expect(priceFeedService.isPriceAvailable('BTC-USD')).toBe(true);
      expect(priceFeedService.isPriceAvailable('NONEXISTENT-USD')).toBe(false);
    });

    it('should clear cache', () => {
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      expect(priceFeedService.getLatestPrice('BTC-USD')).toBeDefined();

      priceFeedService.clearCache();

      expect(priceFeedService.getLatestPrice('BTC-USD')).toBeUndefined();
    });

    it('should return service status', () => {
      const status = priceFeedService.getStatus();

      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('cachedSymbols');
      expect(status).toHaveProperty('config');
      expect(typeof status.isRunning).toBe('boolean');
      expect(typeof status.cachedSymbols).toBe('number');
    });

    it('should subscribe to price updates for specific symbols', () => {
      const callback = vi.fn();
      const unsubscribe = priceFeedService.subscribeToPrices(['BTC-USD', 'ETH-USD'], callback);

      // Update BTC - should trigger callback
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTC-USD' }));

      // Update ETH - should trigger callback
      priceFeedService.updatePrice('ETH-USD', 3000, 'websocket');
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ETH-USD' }));

      // Update SOL - should NOT trigger callback
      callback.mockClear();
      priceFeedService.updatePrice('SOL-USD', 100, 'websocket');
      expect(callback).not.toHaveBeenCalled();

      // Unsubscribe
      unsubscribe();
      callback.mockClear();
      priceFeedService.updatePrice('BTC-USD', 51000, 'websocket');
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle multiple rapid price updates', () => {
      const priceUpdateHandler = vi.fn();
      priceFeedService.on('price_update', priceUpdateHandler);

      // Simulate rapid price updates
      for (let i = 0; i < 100; i++) {
        priceFeedService.updatePrice('BTC-USD', 50000 + i, 'websocket');
      }

      expect(priceUpdateHandler).toHaveBeenCalledTimes(100);
      
      const latestPrice = priceFeedService.getLatestPrice('BTC-USD');
      expect(latestPrice?.price).toBe(50099);

      priceFeedService.off('price_update', priceUpdateHandler);
    });

    it('should include timestamp in price updates', () => {
      const beforeUpdate = Date.now();
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      const afterUpdate = Date.now();

      const price = priceFeedService.getLatestPrice('BTC-USD');

      expect(price?.timestamp).toBeGreaterThanOrEqual(beforeUpdate);
      expect(price?.timestamp).toBeLessThanOrEqual(afterUpdate);
    });
  });

  describe('Price Direction Detection', () => {
    it('should detect price increase', () => {
      let lastDirection: 'up' | 'down' | 'neutral' = 'neutral';
      let lastPrice = 0;

      priceFeedService.on('price_update', (data) => {
        if (lastPrice > 0) {
          if (data.price > lastPrice) lastDirection = 'up';
          else if (data.price < lastPrice) lastDirection = 'down';
          else lastDirection = 'neutral';
        }
        lastPrice = data.price;
      });

      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      priceFeedService.updatePrice('BTC-USD', 50100, 'websocket');

      expect(lastDirection).toBe('up');
    });

    it('should detect price decrease', () => {
      let lastDirection: 'up' | 'down' | 'neutral' = 'neutral';
      let lastPrice = 0;

      priceFeedService.on('price_update', (data) => {
        if (lastPrice > 0) {
          if (data.price > lastPrice) lastDirection = 'up';
          else if (data.price < lastPrice) lastDirection = 'down';
          else lastDirection = 'neutral';
        }
        lastPrice = data.price;
      });

      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      priceFeedService.updatePrice('BTC-USD', 49900, 'websocket');

      expect(lastDirection).toBe('down');
    });

    it('should detect no change', () => {
      let lastDirection: 'up' | 'down' | 'neutral' = 'neutral';
      let lastPrice = 0;

      priceFeedService.on('price_update', (data) => {
        if (lastPrice > 0) {
          if (data.price > lastPrice) lastDirection = 'up';
          else if (data.price < lastPrice) lastDirection = 'down';
          else lastDirection = 'neutral';
        }
        lastPrice = data.price;
      });

      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');

      expect(lastDirection).toBe('neutral');
    });
  });

  describe('P&L Calculation', () => {
    it('should calculate correct P&L for long position with price increase', () => {
      const entryPrice = 50000;
      const quantity = 0.1;
      const side = 'long';
      
      priceFeedService.updatePrice('BTC-USD', 51000, 'websocket');
      const currentPrice = priceFeedService.getLatestPrice('BTC-USD')?.price || entryPrice;

      const direction = side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - entryPrice) * direction;
      const pnl = priceDiff * quantity;
      const pnlPercent = (priceDiff / entryPrice) * 100;

      expect(pnl).toBe(100); // (51000 - 50000) * 0.1 = 100
      expect(pnlPercent).toBe(2); // 2% profit
    });

    it('should calculate correct P&L for long position with price decrease', () => {
      const entryPrice = 50000;
      const quantity = 0.1;
      const side = 'long';
      
      priceFeedService.updatePrice('BTC-USD', 49000, 'websocket');
      const currentPrice = priceFeedService.getLatestPrice('BTC-USD')?.price || entryPrice;

      const direction = side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - entryPrice) * direction;
      const pnl = priceDiff * quantity;
      const pnlPercent = (priceDiff / entryPrice) * 100;

      expect(pnl).toBe(-100); // (49000 - 50000) * 0.1 = -100
      expect(pnlPercent).toBe(-2); // 2% loss
    });

    it('should calculate correct P&L for short position with price decrease', () => {
      const entryPrice = 50000;
      const quantity = 0.1;
      const side = 'short';
      
      priceFeedService.updatePrice('BTC-USD', 49000, 'websocket');
      const currentPrice = priceFeedService.getLatestPrice('BTC-USD')?.price || entryPrice;

      const direction = side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - entryPrice) * direction;
      const pnl = priceDiff * quantity;
      const pnlPercent = (priceDiff / entryPrice) * 100;

      expect(pnl).toBe(100); // (50000 - 49000) * 0.1 = 100 (short profits from price drop)
      expect(pnlPercent).toBe(2); // 2% profit
    });

    it('should calculate correct P&L for short position with price increase', () => {
      const entryPrice = 50000;
      const quantity = 0.1;
      const side = 'short';
      
      priceFeedService.updatePrice('BTC-USD', 51000, 'websocket');
      const currentPrice = priceFeedService.getLatestPrice('BTC-USD')?.price || entryPrice;

      const direction = side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - entryPrice) * direction;
      const pnl = priceDiff * quantity;
      const pnlPercent = (priceDiff / entryPrice) * 100;

      expect(pnl).toBe(-100); // (50000 - 51000) * 0.1 = -100 (short loses from price rise)
      expect(pnlPercent).toBe(-2); // 2% loss
    });

    it('should handle multiple positions with live prices', () => {
      const positions = [
        { symbol: 'BTC-USD', entryPrice: 50000, quantity: 0.1, side: 'long' as const },
        { symbol: 'ETH-USD', entryPrice: 3000, quantity: 1, side: 'long' as const },
        { symbol: 'SOL-USD', entryPrice: 100, quantity: 10, side: 'short' as const },
      ];

      // Update prices
      priceFeedService.updatePrice('BTC-USD', 51000, 'websocket');
      priceFeedService.updatePrice('ETH-USD', 3100, 'websocket');
      priceFeedService.updatePrice('SOL-USD', 95, 'websocket');

      let totalPnL = 0;
      positions.forEach(pos => {
        const currentPrice = priceFeedService.getLatestPrice(pos.symbol)?.price || pos.entryPrice;
        const direction = pos.side === 'long' ? 1 : -1;
        const priceDiff = (currentPrice - pos.entryPrice) * direction;
        const pnl = priceDiff * pos.quantity;
        totalPnL += pnl;
      });

      // BTC: (51000-50000) * 0.1 = 100
      // ETH: (3100-3000) * 1 = 100
      // SOL: (100-95) * 10 = 50 (short profits from drop)
      expect(totalPnL).toBe(250);
    });
  });

  describe('Symbol Normalization', () => {
    it('should handle BTCUSDT format', () => {
      const normalizeSymbol = (symbol: string): string => {
        if (symbol.endsWith('USDT')) {
          return `${symbol.slice(0, -4)}-USD`;
        }
        if (symbol.endsWith('USD') && !symbol.includes('-')) {
          return `${symbol.slice(0, -3)}-USD`;
        }
        return symbol;
      };

      expect(normalizeSymbol('BTCUSDT')).toBe('BTC-USD');
      expect(normalizeSymbol('ETHUSDT')).toBe('ETH-USD');
      expect(normalizeSymbol('SOLUSDT')).toBe('SOL-USD');
    });

    it('should handle BTCUSD format', () => {
      const normalizeSymbol = (symbol: string): string => {
        if (symbol.endsWith('USDT')) {
          return `${symbol.slice(0, -4)}-USD`;
        }
        if (symbol.endsWith('USD') && !symbol.includes('-')) {
          return `${symbol.slice(0, -3)}-USD`;
        }
        return symbol;
      };

      expect(normalizeSymbol('BTCUSD')).toBe('BTC-USD');
      expect(normalizeSymbol('ETHUSD')).toBe('ETH-USD');
    });

    it('should preserve BTC-USD format', () => {
      const normalizeSymbol = (symbol: string): string => {
        if (symbol.endsWith('USDT')) {
          return `${symbol.slice(0, -4)}-USD`;
        }
        if (symbol.endsWith('USD') && !symbol.includes('-')) {
          return `${symbol.slice(0, -3)}-USD`;
        }
        return symbol;
      };

      expect(normalizeSymbol('BTC-USD')).toBe('BTC-USD');
      expect(normalizeSymbol('ETH-USD')).toBe('ETH-USD');
    });
  });
});
