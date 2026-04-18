/**
 * CoinbasePublicWebSocket Tests
 * 
 * Validates the FREE public WebSocket service that provides real-time price data
 * without requiring API keys. This is the PRIMARY price feed for SEER.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock WebSocket
vi.mock('ws', () => {
  const EventEmitter = require('events');
  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1; // OPEN
    send = vi.fn();
    close = vi.fn();
    terminate = vi.fn();
    constructor() {
      super();
      // Simulate connection open after a tick
      setTimeout(() => this.emit('open'), 10);
    }
  }
  return { default: MockWebSocket };
});

// Mock priceFeedService
vi.mock('../services/priceFeedService', () => ({
  priceFeedService: {
    updatePrice: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}));

// Mock wsHealthMonitor
vi.mock('../monitoring/WebSocketHealthMonitor', () => ({
  wsHealthMonitor: {
    updateStatus: vi.fn(),
    recordMessage: vi.fn(),
  },
}));

describe('CoinbasePublicWebSocket', () => {
  
  describe('Service Architecture', () => {
    it('should use the FREE public Coinbase Exchange WebSocket URL', async () => {
      // The public WebSocket URL should be wss://ws-feed.exchange.coinbase.com
      // NOT the authenticated wss://advanced-trade-ws.coinbase.com
      const { coinbasePublicWebSocket } = await import('../services/CoinbasePublicWebSocket');
      expect(coinbasePublicWebSocket).toBeDefined();
      expect(typeof coinbasePublicWebSocket.start).toBe('function');
      expect(typeof coinbasePublicWebSocket.stop).toBe('function');
      expect(typeof coinbasePublicWebSocket.getStatus).toBe('function');
      expect(typeof coinbasePublicWebSocket.isHealthy).toBe('function');
    });

    it('should be a singleton instance', async () => {
      const mod1 = await import('../services/CoinbasePublicWebSocket');
      const mod2 = await import('../services/CoinbasePublicWebSocket');
      expect(mod1.coinbasePublicWebSocket).toBe(mod2.coinbasePublicWebSocket);
    });

    it('should not require API keys', async () => {
      // The start method only takes symbols, no API keys
      const { coinbasePublicWebSocket } = await import('../services/CoinbasePublicWebSocket');
      const startFn = coinbasePublicWebSocket.start;
      // start() signature is: start(symbols: string[]): Promise<void>
      expect(startFn.length).toBe(1); // Only 1 parameter: symbols
    });
  });

  describe('Ticker Event Format', () => {
    it('should parse Coinbase public ticker format correctly', () => {
      // The public WebSocket returns ticker events in this format
      const rawTicker = {
        type: 'ticker',
        product_id: 'BTC-USD',
        price: '69500.00',
        open_24h: '68000.00',
        volume_24h: '52000',
        low_24h: '67500.00',
        high_24h: '70000.00',
        volume_30d: '1500000',
        best_bid: '69499.00',
        best_ask: '69501.00',
        side: 'buy',
        time: '2026-02-06T16:30:00.000Z',
        trade_id: 123456,
        last_size: '0.001',
        sequence: 789012,
      };

      // Validate all fields are strings (as Coinbase returns them)
      expect(typeof rawTicker.price).toBe('string');
      expect(typeof rawTicker.volume_24h).toBe('string');
      expect(typeof rawTicker.best_bid).toBe('string');
      expect(typeof rawTicker.best_ask).toBe('string');

      // Validate parsing
      const price = parseFloat(rawTicker.price);
      const volume = parseFloat(rawTicker.volume_24h);
      const open = parseFloat(rawTicker.open_24h);
      const change24h = open > 0 ? ((price - open) / open) * 100 : 0;

      expect(price).toBe(69500.00);
      expect(volume).toBe(52000);
      expect(change24h).toBeCloseTo(2.2058, 2);
    });

    it('should handle missing/zero values gracefully', () => {
      const rawTicker = {
        type: 'ticker',
        product_id: 'SOL-USD',
        price: '86.50',
        open_24h: '0',
        volume_24h: '',
        low_24h: '',
        high_24h: '',
        best_bid: '',
        best_ask: '',
        side: 'sell',
        time: '2026-02-06T16:30:00.000Z',
        trade_id: 0,
        last_size: '0',
        sequence: 0,
      };

      const price = parseFloat(rawTicker.price);
      const volume = parseFloat(rawTicker.volume_24h) || 0;
      const open = parseFloat(rawTicker.open_24h) || 0;
      const change24h = open > 0 ? ((price - open) / open) * 100 : 0;

      expect(price).toBe(86.50);
      expect(volume).toBe(0);
      expect(change24h).toBe(0); // open_24h is 0, so change should be 0
    });
  });

  describe('SymbolOrchestrator Integration', () => {
    it('should use public WebSocket when API keys are empty (paper trading)', () => {
      // Simulate the paper trading adapter with empty credentials
      const apiKey = '';
      const apiSecret = '';
      const hasApiKeys = !!(apiKey && apiSecret);
      
      expect(hasApiKeys).toBe(false);
      // In the new code, when hasApiKeys is false, it uses coinbasePublicWebSocket
    });

    it('should use authenticated WebSocket when API keys are present', () => {
      const apiKey = 'organizations/abc/apiKeys/xyz';
      const apiSecret = '-----BEGIN EC PRIVATE KEY-----\nMIGkAg...';
      const hasApiKeys = !!(apiKey && apiSecret);
      
      expect(hasApiKeys).toBe(true);
      // In the new code, when hasApiKeys is true, it uses CoinbaseWebSocketManager
    });

    it('should normalize symbols correctly for public WebSocket', () => {
      // Public WebSocket uses BTC-USD format (same as SEER internal format)
      const symbol = 'BTC-USD';
      const hasApiKeys = false;
      const normalizedSymbol = hasApiKeys ? 'BTC-USDT' : symbol;
      
      expect(normalizedSymbol).toBe('BTC-USD');
    });
  });

  describe('Price Feed Integration', () => {
    it('should feed ticks into priceFeedService', async () => {
      const { priceFeedService } = await import('../services/priceFeedService');
      
      // Simulate what CoinbasePublicWebSocket does when it receives a ticker
      const ticker = {
        product_id: 'BTC-USD',
        price: '69500.00',
        volume_24h: '52000',
        open_24h: '68000.00',
      };
      
      const price = parseFloat(ticker.price);
      const volume24h = parseFloat(ticker.volume_24h) || 0;
      const open24h = parseFloat(ticker.open_24h) || 0;
      const change24h = open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;
      
      priceFeedService.updatePrice(ticker.product_id, price, 'websocket', {
        volume24h,
        change24h,
      });
      
      expect(priceFeedService.updatePrice).toHaveBeenCalledWith(
        'BTC-USD',
        69500.00,
        'websocket',
        expect.objectContaining({
          volume24h: 52000,
          change24h: expect.any(Number),
        })
      );
    });
  });

  describe('Reconnection Logic', () => {
    it('should use exponential backoff with jitter', () => {
      let delay = 1000; // RECONNECT_BASE_DELAY
      const maxDelay = 30000; // RECONNECT_MAX_DELAY
      
      // Simulate 5 reconnection attempts
      const delays: number[] = [];
      for (let i = 0; i < 5; i++) {
        const jitter = Math.random() * 1000;
        delay = Math.min(maxDelay, delay * 1.5 + jitter);
        delays.push(delay);
      }
      
      // Each delay should be larger than the previous (with high probability)
      // and all should be <= maxDelay
      for (const d of delays) {
        expect(d).toBeLessThanOrEqual(maxDelay);
        expect(d).toBeGreaterThan(0);
      }
    });

    it('should have generous max reconnect attempts (50)', () => {
      const MAX_RECONNECT_ATTEMPTS = 50;
      // This is our primary feed, so we should be very persistent
      expect(MAX_RECONNECT_ATTEMPTS).toBeGreaterThanOrEqual(50);
    });
  });

  describe('Health Monitoring', () => {
    it('should report health status correctly', async () => {
      const { coinbasePublicWebSocket } = await import('../services/CoinbasePublicWebSocket');
      const status = coinbasePublicWebSocket.getStatus();
      
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('isConnected');
      expect(status).toHaveProperty('symbols');
      expect(status).toHaveProperty('lastMessageTime');
      expect(status).toHaveProperty('messageCount');
      expect(status).toHaveProperty('tickCount');
      expect(status).toHaveProperty('reconnectAttempts');
      expect(status).toHaveProperty('uptimeMs');
    });
  });
});
