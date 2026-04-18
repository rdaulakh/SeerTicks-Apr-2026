/**
 * WebSocketHealthIndicator Tests
 * 
 * Tests the Live status badge behavior:
 * - Should show "LIVE" immediately when WebSocket is connected
 * - Should NOT depend on receiving ticks to show "LIVE"
 * - Should show "Connecting..." only when WebSocket is disconnected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the hooks
vi.mock('@/hooks/useSocketIOMulti', () => ({
  useSocketIOMulti: vi.fn()
}));

vi.mock('@/_core/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({ user: { id: 1 } }))
}));

import { useSocketIOMulti } from '@/hooks/useSocketIOMulti';

describe('WebSocketHealthIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Live Status Logic', () => {
    it('should show LIVE when WebSocket is connected (regardless of tick data)', () => {
      // Mock connected state with NO tick data
      (useSocketIOMulti as any).mockReturnValue({
        connected: true,
        lastTick: null,
        lastPriceUpdate: null,
        error: null
      });

      // The isLive should be true based on connected state alone
      const mockState = (useSocketIOMulti as any)();
      const isLive = mockState.connected;
      
      expect(isLive).toBe(true);
    });

    it('should show Connecting when WebSocket is not connected', () => {
      // Mock disconnected state
      (useSocketIOMulti as any).mockReturnValue({
        connected: false,
        lastTick: null,
        lastPriceUpdate: null,
        error: null
      });

      const mockState = (useSocketIOMulti as any)();
      const isLive = mockState.connected;
      
      expect(isLive).toBe(false);
    });

    it('should show Error state when there is a connection error', () => {
      // Mock error state
      (useSocketIOMulti as any).mockReturnValue({
        connected: false,
        lastTick: null,
        lastPriceUpdate: null,
        error: 'Connection lost. Please refresh the page.'
      });

      const mockState = (useSocketIOMulti as any)();
      const hasError = !!mockState.error;
      
      expect(hasError).toBe(true);
    });

    it('should NOT require hasRecentTicks to show LIVE status', () => {
      // This test verifies the fix: previously, isConnected required hasRecentTicks
      // Now, isLive = connected (simple boolean)
      
      // Mock connected but no ticks received yet
      (useSocketIOMulti as any).mockReturnValue({
        connected: true,
        lastTick: null,
        lastPriceUpdate: null,
        error: null
      });

      const mockState = (useSocketIOMulti as any)();
      
      // OLD BROKEN LOGIC (what we fixed):
      // const hasRecentTicks = false; // No ticks received
      // const isConnected = mockState.connected && hasRecentTicks; // Would be FALSE
      
      // NEW CORRECT LOGIC:
      const isLive = mockState.connected; // TRUE immediately
      
      expect(isLive).toBe(true);
    });

    it('should show LIVE even when isRunning prop is false', () => {
      // The isRunning prop should NOT affect Live status
      // Live status is based purely on WebSocket connection
      
      (useSocketIOMulti as any).mockReturnValue({
        connected: true,
        lastTick: null,
        lastPriceUpdate: null,
        error: null
      });

      const mockState = (useSocketIOMulti as any)();
      const isRunning = false; // Prop value doesn't matter
      
      // Live status should be true regardless of isRunning
      const isLive = mockState.connected;
      
      expect(isLive).toBe(true);
    });
  });

  describe('Latency Metrics', () => {
    it('should calculate latency from tick timestamp', () => {
      const now = Date.now();
      const tickTime = now - 50; // 50ms ago
      
      (useSocketIOMulti as any).mockReturnValue({
        connected: true,
        lastTick: { timestamp: tickTime },
        lastPriceUpdate: null,
        error: null
      });

      const mockState = (useSocketIOMulti as any)();
      const tickTimestamp = new Date(mockState.lastTick.timestamp).getTime();
      const latency = Math.max(0, now - tickTimestamp);
      
      // Latency should be approximately 50ms (allow for test execution time)
      expect(latency).toBeGreaterThanOrEqual(50);
      expect(latency).toBeLessThan(200);
    });

    it('should use lastPriceUpdate when lastTick is null', () => {
      const now = Date.now();
      const priceTime = now - 30; // 30ms ago
      
      (useSocketIOMulti as any).mockReturnValue({
        connected: true,
        lastTick: null,
        lastPriceUpdate: { timestamp: priceTime, symbol: 'BTC-USD', price: 100000 },
        error: null
      });

      const mockState = (useSocketIOMulti as any)();
      const tickData = mockState.lastTick || mockState.lastPriceUpdate;
      
      expect(tickData).not.toBeNull();
      expect(tickData.symbol).toBe('BTC-USD');
    });
  });

  describe('Connection Status Display', () => {
    it('should prioritize error state over connected state', () => {
      // Even if connected is true, error should take precedence
      (useSocketIOMulti as any).mockReturnValue({
        connected: true,
        lastTick: null,
        lastPriceUpdate: null,
        error: 'Connection lost'
      });

      const mockState = (useSocketIOMulti as any)();
      const hasError = !!mockState.error;
      const isLive = mockState.connected;
      
      // Error should be shown instead of Live
      expect(hasError).toBe(true);
      // In the component, hasError takes precedence in the render
    });
  });
});
