import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { priceFeedService } from '../priceFeedService';

describe('PriceFeedService', () => {
  beforeEach(() => {
    // Clear any existing prices
    priceFeedService.clearCache();
  });

  describe('updatePrice', () => {
    it('should store price in cache immediately', () => {
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      
      const cached = priceFeedService.getLatestPrice('BTC-USD');
      expect(cached).toBeDefined();
      expect(cached?.price).toBe(50000);
      expect(cached?.source).toBe('websocket');
    });

    it('should emit price_update event on every update', () => {
      const listener = vi.fn();
      priceFeedService.on('price_update', listener);
      
      priceFeedService.updatePrice('ETH-USD', 3000, 'websocket');
      
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        symbol: 'ETH-USD',
        price: 3000,
        source: 'websocket',
      }));
      
      priceFeedService.off('price_update', listener);
    });

    it('should emit event for every tick (no batching)', () => {
      const listener = vi.fn();
      priceFeedService.on('price_update', listener);
      
      // Simulate rapid price updates
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      priceFeedService.updatePrice('BTC-USD', 50001, 'websocket');
      priceFeedService.updatePrice('BTC-USD', 50002, 'websocket');
      
      // Each update should trigger an event immediately
      expect(listener).toHaveBeenCalledTimes(3);
      
      priceFeedService.off('price_update', listener);
    });

    it('should include metadata in price updates', () => {
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket', {
        volume24h: 1000000,
        change24h: 2.5,
      });
      
      const cached = priceFeedService.getLatestPrice('BTC-USD');
      // Metadata is stored directly on PriceData, not in a nested metadata object
      expect(cached?.volume24h).toBe(1000000);
      expect(cached?.change24h).toBe(2.5);
    });
  });

  describe('getLatestPrice', () => {
    it('should return undefined for unknown symbols', () => {
      const cached = priceFeedService.getLatestPrice('UNKNOWN-USD');
      expect(cached).toBeUndefined();
    });

    it('should return the most recent price', () => {
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      priceFeedService.updatePrice('BTC-USD', 51000, 'websocket');
      
      const cached = priceFeedService.getLatestPrice('BTC-USD');
      expect(cached?.price).toBe(51000);
    });

    it('should include timestamp', () => {
      const beforeUpdate = Date.now();
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      const afterUpdate = Date.now();
      
      const cached = priceFeedService.getLatestPrice('BTC-USD');
      expect(cached?.timestamp).toBeGreaterThanOrEqual(beforeUpdate);
      expect(cached?.timestamp).toBeLessThanOrEqual(afterUpdate);
    });
  });

  describe('getPrices', () => {
    it('should return prices for multiple symbols', () => {
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      priceFeedService.updatePrice('ETH-USD', 3000, 'websocket');
      
      const prices = priceFeedService.getPrices(['BTC-USD', 'ETH-USD']);
      
      expect(prices.get('BTC-USD')?.price).toBe(50000);
      expect(prices.get('ETH-USD')?.price).toBe(3000);
    });

    it('should skip symbols without cached prices', () => {
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      
      const prices = priceFeedService.getPrices(['BTC-USD', 'UNKNOWN-USD']);
      
      expect(prices.has('BTC-USD')).toBe(true);
      expect(prices.has('UNKNOWN-USD')).toBe(false);
    });
  });

  describe('getAllPrices', () => {
    it('should return all cached prices', () => {
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      priceFeedService.updatePrice('ETH-USD', 3000, 'websocket');
      priceFeedService.updatePrice('SOL-USD', 100, 'websocket');
      
      const allPrices = priceFeedService.getAllPrices();
      
      expect(allPrices.length).toBe(3);
      expect(allPrices.find(p => p.symbol === 'BTC-USD')?.price).toBe(50000);
      expect(allPrices.find(p => p.symbol === 'ETH-USD')?.price).toBe(3000);
      expect(allPrices.find(p => p.symbol === 'SOL-USD')?.price).toBe(100);
    });
  });

  describe('clearCache', () => {
    it('should clear all cached prices', () => {
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      priceFeedService.updatePrice('ETH-USD', 3000, 'websocket');
      
      priceFeedService.clearCache();
      
      expect(priceFeedService.getLatestPrice('BTC-USD')).toBeUndefined();
      expect(priceFeedService.getLatestPrice('ETH-USD')).toBeUndefined();
    });
  });

  describe('subscription pattern', () => {
    it('should allow multiple subscribers', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      
      priceFeedService.on('price_update', listener1);
      priceFeedService.on('price_update', listener2);
      
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      
      priceFeedService.off('price_update', listener1);
      priceFeedService.off('price_update', listener2);
    });

    it('should allow unsubscribing', () => {
      const listener = vi.fn();
      
      priceFeedService.on('price_update', listener);
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      expect(listener).toHaveBeenCalledTimes(1);
      
      priceFeedService.off('price_update', listener);
      priceFeedService.updatePrice('BTC-USD', 51000, 'websocket');
      expect(listener).toHaveBeenCalledTimes(1); // Still 1, not 2
    });
  });

  describe('symbol normalization', () => {
    it('should normalize BTCUSDT to BTC-USD', () => {
      priceFeedService.updatePrice('BTC-USD', 50000, 'websocket');
      
      // Should find price using various formats
      expect(priceFeedService.getLatestPrice('BTC-USD')?.price).toBe(50000);
      expect(priceFeedService.getLatestPrice('BTCUSDT')?.price).toBe(50000);
      expect(priceFeedService.getLatestPrice('BTC/USDT')?.price).toBe(50000);
    });

    it('should normalize ETH/USDT to ETH-USD', () => {
      priceFeedService.updatePrice('ETH-USD', 3000, 'websocket');
      
      expect(priceFeedService.getLatestPrice('ETH-USD')?.price).toBe(3000);
      expect(priceFeedService.getLatestPrice('ETHUSDT')?.price).toBe(3000);
      expect(priceFeedService.getLatestPrice('ETH/USDT')?.price).toBe(3000);
    });
  });

  describe('real-time price flow simulation', () => {
    it('should handle rapid price updates without dropping any', async () => {
      const receivedPrices: number[] = [];
      const listener = (data: any) => {
        receivedPrices.push(data.price);
      };
      
      priceFeedService.on('price_update', listener);
      
      // Simulate 100 rapid price updates
      for (let i = 0; i < 100; i++) {
        priceFeedService.updatePrice('BTC-USD', 50000 + i, 'websocket');
      }
      
      // All 100 updates should be received
      expect(receivedPrices.length).toBe(100);
      expect(receivedPrices[0]).toBe(50000);
      expect(receivedPrices[99]).toBe(50099);
      
      priceFeedService.off('price_update', listener);
    });
  });
});
